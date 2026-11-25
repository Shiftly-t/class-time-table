#!/usr/bin/env python3
"""Compare the supplied baseline with the exact deployed QA source generations in Cloud Shell."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from zipfile import ZipFile

PROJECT = "shiftly-t-test"
REGION = "asia-northeast1"
NAMES = (
    "qaBookingAdminApi", "qaBookingPublicApi", "qaBookingStudentDeleted", "qaNormalAuthorityApi",
    "qaSeasonalAuthorityApi", "qaRankingReadApi",
)
SOURCE_BUCKET = "gcf-v2-sources-592978959203-asia-northeast1"


def source_map(archive):
    with ZipFile(archive) as zip_file:
        result = {}
        for metadata in zip_file.infolist():
            path = PurePosixPath(metadata.filename)
            if metadata.is_dir() or path.is_absolute() or ".." in path.parts:
                continue
            if any(part.startswith(".") or part in {"node_modules", "test", "tests", "backup", "backups"} for part in path.parts):
                continue
            if path.suffix not in {".cjs", ".mjs", ".js", ".json"} or metadata.file_size > 2_000_000:
                continue
            if str(path) in result:
                raise ValueError("Unexpected duplicate source path")
            result[str(path)] = hashlib.sha256(zip_file.read(metadata)).hexdigest()
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("authority_zip", type=Path, help="The original Functions source attachment")
    parser.add_argument("evidence_dir", type=Path, help="The extracted QA evidence directory")
    parser.add_argument("--ranking-baseline", type=Path, help="Optional original ranking-only deployment ZIP")
    args = parser.parse_args()
    authority = source_map(args.authority_zip)
    ranking = source_map(args.ranking_baseline) if args.ranking_baseline else None
    if not {"index.js", "coordination.cjs", "stage2-bridge.cjs", "package.json"}.issubset(authority):
        parser.error("Missing required authority source files")

    results = {}
    with tempfile.TemporaryDirectory() as temp:
        for function in NAMES:
            evidence = json.loads((args.evidence_dir / "functions" / f"{function}.json").read_text())
            live = json.loads(subprocess.check_output([
                "gcloud", "functions", "describe", function, "--gen2",
                f"--project={PROJECT}", f"--region={REGION}",
                "--format=json(name,state,buildConfig.runtime,buildConfig.sourceProvenance,serviceConfig.revision)",
            ]))
            source = live.get("buildConfig", {}).get("sourceProvenance", {}).get("resolvedStorageSource", {})
            generation = str(source.get("generation", ""))
            expected = evidence.get("sourceProvenance", {}).get("resolvedStorageSource", {})
            if (live.get("name") != f"projects/{PROJECT}/locations/{REGION}/functions/{function}"
                    or live.get("state") != "ACTIVE" or live.get("buildConfig", {}).get("runtime") != "nodejs22"
                    or live.get("serviceConfig", {}).get("revision") != evidence.get("revision")
                    or source.get("bucket") != SOURCE_BUCKET or source.get("object") != f"{function}/function-source.zip"
                    or not re.fullmatch(r"\d+", generation) or generation != str(expected.get("generation"))):
                results[function] = {"state": "DEPLOYMENT_CHANGED"}
                continue

            target = Path(temp) / f"{function}.zip"
            subprocess.run(["gcloud", "storage", "cp", "--quiet",
                            f"gs://{SOURCE_BUCKET}/{source['object']}#{generation}", str(target)], check=True)
            deployed = source_map(target)
            baseline = ranking if function == "qaRankingReadApi" else authority
            if baseline is None:
                results[function] = {"state": "RANKING_BASELINE_REQUIRED", "sourceFiles": len(deployed)}
            else:
                missing = sorted(baseline.keys() - deployed.keys())
                extra = sorted(deployed.keys() - baseline.keys())
                changed = sorted(path for path in baseline.keys() & deployed.keys() if baseline[path] != deployed[path])
                results[function] = {
                    "state": "MATCH" if not (missing or extra or changed) else "SOURCE_DIFFERS",
                    "baselineFiles": len(baseline), "deployedFiles": len(deployed),
                    "missingPaths": missing, "extraPaths": extra, "changedPaths": changed
                }

    print(json.dumps(results, indent=2, ensure_ascii=False))
    if all(result["state"] == "MATCH" for result in results.values()):
        print("SUCCESS SHIFTLY QA DEPLOYED SOURCE VERIFIED")
    else:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
