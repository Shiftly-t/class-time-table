#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

# Google Cloud Shell. Collect metadata and applied Rules; optional archives stay private.
usage() {
  printf 'Usage: bash %s PROJECT REGION BOOKING_REVISION SEASONAL_REVISION FROM_UTC TO_UTC [--download-source]\n' "$0" >&2
  exit 2
}
if (( $# < 6 || $# > 7 )); then usage; fi
project=$1
region=$2
booking_revision=$3
seasonal_revision=$4
from_utc=$5
to_utc=$6
download_source=false
if (( $# == 7 )); then
  [[ $7 == --download-source ]] || usage
  download_source=true
fi
[[ $project =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ && $region =~ ^[a-z]+(-[a-z]+)+[0-9]+$ ]] || usage
[[ $booking_revision =~ ^bookingadminapi-[a-z0-9-]*[a-z0-9]$ && $seasonal_revision =~ ^seasonalauthorityapi-[a-z0-9-]*[a-z0-9]$ ]] || usage
utc_format='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
[[ $from_utc =~ $utc_format && $to_utc =~ $utc_format && $from_utc < $to_utc ]] || usage
for command in gcloud jq curl sha256sum; do
  command -v "$command" >/dev/null || { printf 'Missing: %s\n' "$command" >&2; exit 1; }
done

evidence=$(mktemp -d "$PWD/shiftly-coordination.XXXXXX")
mkdir "$evidence/share-review" "$evidence/private"
report="$evidence/share-review"
private="$evidence/private"
printf 'Output: %s\n' "$evidence"
date -u +%FT%TZ > "$report/collected-at-utc.txt"

get() {
  local token
  token=$(gcloud auth print-access-token) || return
  printf 'Authorization: Bearer %s\n' "$token" | curl --disable --proto '=https' --request GET --fail --silent --show-error --max-time 30 -H @- "$1"
}

record_failure() { printf '%s\n' "$1" >> "$report/unavailable.txt"; }

capture() {
  local path=$1
  shift
  if ! "$@" > "$path.tmp"; then
    rm -f "$path.tmp"
    record_failure "${path##*/}"
    return 1
  fi
  mv "$path.tmp" "$path"
}

control_document() {
  local document=$1
  shift
  local url="https://firestore.googleapis.com/v1/projects/$project/databases/(default)/documents/systemConfig/$document"
  local separator='?' field
  for field in "$@"; do
    url+="${separator}mask.fieldPaths=$field"
    separator='&'
  done
  get "$url" | jq -e '{name,createTime,updateTime,fields:(.fields | {
    enabled:.enabled.booleanValue, protocolVersion:.protocolVersion.integerValue,
    allWritersMigrated:.allWritersMigrated.booleanValue, enforceDirectWriteDeny:.enforceDirectWriteDeny.booleanValue,
    state:(.state.stringValue | if IN("applying","verifying","completed","failed") then . else null end)
  } | with_entries(select(.value != null)))}'
}

capture "$report/coordination.json" control_document coordination \
  enabled protocolVersion allWritersMigrated enforceDirectWriteDeny || true
capture "$report/maintenance.json" control_document maintenance enabled || true
capture "$report/restore-job.json" control_document restoreJob state || true

hosting_release() {
  get "https://firebasehosting.googleapis.com/v1beta1/sites/$project/channels/live" |
    jq -e '.release | {name,releaseTime,version:{name:.version.name,fileCount:.version.fileCount}}'
}
capture "$report/hosting-release.json" hosting_release || true

rules_release() {
  get "https://firebaserules.googleapis.com/v1/projects/$project/releases/cloud.firestore" |
    jq -e '{name,rulesetName,updateTime} | select(.rulesetName | type == "string")'
}
rules_source() {
  get "https://firebaserules.googleapis.com/v1/$1" |
    jq -e '{name,createTime,files:[.source.files[] | {name,content}]}'
}
if capture "$report/firestore-rules-release.json" rules_release; then
  ruleset=$(jq -r '.rulesetName' "$report/firestore-rules-release.json")
  capture "$private/firestore-rules-source.json" rules_source "$ruleset" || true
fi

function_metadata() {
  gcloud functions describe "$1" --gen2 --project="$project" --region="$region" --format=json |
    jq -e '{name,environment,state,updateTime,buildConfig:{build:.buildConfig.build,runtime:.buildConfig.runtime,entryPoint:.buildConfig.entryPoint,resolvedStorageSource:.buildConfig.sourceProvenance.resolvedStorageSource},serviceConfig:{service:.serviceConfig.service,revision:.serviceConfig.revision,ingressSettings:.serviceConfig.ingressSettings}}'
}
service_traffic() {
  gcloud run services describe "$1" --project="$project" --region="$region" --format=json |
    jq -e '{latestReadyRevision:.status.latestReadyRevisionName,traffic:[.status.traffic[]? | {revisionName,percent,tag}],invokerIamDisabled:.metadata.annotations["run.googleapis.com/invoker-iam-disabled"],ingress:.metadata.annotations["run.googleapis.com/ingress"]}'
}
revision_metadata() {
  gcloud run revisions describe "$1" --project="$project" --region="$region" --format=json |
    jq -e '{revision:.metadata.name,createdAt:.metadata.creationTimestamp,imageDigest:.status.imageDigest}'
}
build_metadata() {
  local resource=$1
  local build_project build_region build_id
  if [[ $resource =~ ^projects/([^/]+)/locations/([^/]+)/builds/([^/]+)$ ]]; then
    build_project=${BASH_REMATCH[1]}
    build_region=${BASH_REMATCH[2]}
    build_id=${BASH_REMATCH[3]}
  else
    return 1
  fi
  if [[ $build_project =~ ^[0-9]+$ ]]; then build_project=$project; fi
  gcloud builds describe "$build_id" --project="$build_project" --region="$build_region" --format=json |
    jq -e '{id,status,images:[.results.images[]? | {digest}],resolvedStorageSource:.sourceProvenance.resolvedStorageSource}'
}

historical_build() {
  local build_region=$1 digest=$2
  gcloud builds list --project="$project" --region="$build_region" \
    --filter="status=SUCCESS AND results.images.digest=\"$digest\"" \
    --format='json(id,status,results.images,sourceProvenance.resolvedStorageSource)' |
    jq -e --arg digest "$digest" '[.[] | select(.status == "SUCCESS" and any(.results.images[]?; .digest == $digest)) |
      {id,status,images:[.results.images[]? | {digest}],resolvedStorageSource:.sourceProvenance.resolvedStorageSource}] |
      if length == 1 then .[0] else error("Expected one historical build matching the revision digest") end'
}

# Download only after matching the incident revision image to a build digest.
collect_source() {
  local name=$1 incident=$2 metadata=$3
  local revision build build_region image digest object archive build_report
  revision=$(jq -r '.serviceConfig.revision // "" | split("/")[-1]' "$metadata")
  if [[ ! -s "$report/$incident.json" ]]; then
    record_failure "Source for $incident: revision metadata unavailable"
    return
  fi
  build=$(jq -r '.buildConfig.build // ""' "$metadata")
  image=$(jq -r '.imageDigest // ""' "$report/$incident.json")
  digest=${image##*@}
  if [[ ! $digest =~ ^sha256:[a-f0-9]{64}$ ]]; then
    record_failure "Source for $incident: revision image digest unavailable"
    return
  fi
  build_report="$report/$incident-build.json"
  if [[ $revision == "$incident" ]]; then
    capture "$build_report" build_metadata "$build" || return 0
  else
    build_region=$region
    if [[ $build =~ ^projects/[^/]+/locations/([^/]+)/builds/[^/]+$ ]]; then build_region=${BASH_REMATCH[1]}; fi
    capture "$build_report" historical_build "$build_region" "$digest" || return 0
  fi
  if ! jq -e --arg digest "$digest" '.status == "SUCCESS" and any(.images[]; .digest == $digest)' "$build_report" >/dev/null; then
    record_failure "Source for $incident: Cloud Build image digest not verified"
    return
  fi
  if ! $download_source; then return; fi
  if ! object=$(jq -er '.resolvedStorageSource | select(.bucket and .object and .generation) | "gs://\(.bucket)/\(.object)#\(.generation)"' "$build_report"); then
    record_failure "Source for $incident: immutable storage generation unavailable"
    return
  fi
  archive="$private/$name-$incident.zip"
  if gcloud storage cp "$object" "$archive" --project="$project" >/dev/null; then
    (cd "$private" && sha256sum "${archive##*/}") > "$report/$incident-source.sha256"
  else
    record_failure "Source archive for $incident"
  fi
}

function_list() {
  gcloud functions list --project="$project" --regions="$region" --v2 \
    --format='json(name,environment,state,updateTime)'
}
if capture "$report/functions.json" function_list; then
  while IFS= read -r name; do
    metadata="$report/function-$name.json"
    capture "$metadata" function_metadata "$name" || continue
    service=$(jq -r '.serviceConfig.service // "" | split("/")[-1]' "$metadata")
    if [[ -z $service ]]; then
      record_failure "Cloud Run service for $name"
      continue
    fi
    traffic="$report/service-$service.json"
    capture "$traffic" service_traffic "$service" || printf '{"unavailable":true}\n' > "$traffic"
    incident=''
    case "$name" in
      bookingAdminApi) incident=$booking_revision ;;
      seasonalAuthorityApi) incident=$seasonal_revision ;;
    esac
    while IFS= read -r revision; do
      capture "$report/$revision.json" revision_metadata "$revision" || true
    done < <({ jq -r '.traffic[]?.revisionName // empty' "$traffic"; printf '%s\n' "$incident"; } | sed '/^$/d' | sort -u)
    if [[ -n $incident ]]; then collect_source "$name" "$incident" "$metadata"; fi
  done < <(jq -r '.[] | .name | split("/")[-1]' "$report/functions.json")
fi

incident_request_logs() {
  gcloud logging read "
    resource.type=\"cloud_run_revision\"
    resource.labels.location=\"$region\"
    (resource.labels.revision_name=\"$booking_revision\"
     OR resource.labels.revision_name=\"$seasonal_revision\")
    log_id(\"run.googleapis.com/requests\")
    httpRequest.status=400
    timestamp>=\"$from_utc\"
    timestamp<\"$to_utc\"
  " --project="$project" --order=asc --limit=30 \
    --format='json(timestamp,resource.labels.revision_name,httpRequest.requestMethod,httpRequest.status,trace)'
}
if capture "$private/incident-traces.json" incident_request_logs; then
  jq 'map(del(.trace))' "$private/incident-traces.json" > "$report/incident-requests.json"
  trace_filter=$(jq -r --arg prefix "projects/$project/traces/" '[.[].trace | strings | select(startswith($prefix) and (split("/")[-1] | test("^[a-f0-9]{32}$")))] | unique | map("trace=" + tojson) | join(" OR ")' "$private/incident-traces.json")
  if [[ -n $trace_filter ]]; then
    incident_details() {
      gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"$region\" AND ($trace_filter) AND NOT log_id(\"run.googleapis.com/requests\") AND timestamp>=\"$from_utc\" AND timestamp<\"$to_utc\"" \
        --project="$project" --order=asc --limit=100 --format='json(timestamp,trace,resource.labels.revision_name,jsonPayload,textPayload)' |
        jq --slurpfile requests "$private/incident-traces.json" '
        def verification: if IN("VALID","INVALID","MISSING") then . else null end;
        map(. as $entry | (.jsonPayload | objects // {}) as $payload | ($payload.error | objects // {}) as $error |
          ($payload.verifications | objects // {}) as $checks | {
          timestamp, revision:.resource.labels.revision_name,
          requestTimes:[$requests[0][] | select(.trace == $entry.trace) | .timestamp],
          action:(($payload.action // $payload.operation // $error.action) | if IN("capabilities","inspectControl","setMaintenance","listSnapshots","createSnapshot","exportSnapshot","inspectRestoreJob","courses","getSettings","roster","slotDemand","teachers","view","requestStatus") then . else null end),
          code:((($error.status // $error.code // $payload.status // $payload.code) | strings | sub("^functions/"; "") | ascii_upcase | gsub("-"; "_") | if IN("FAILED_PRECONDITION","INVALID_ARGUMENT","OUT_OF_RANGE","UNAUTHENTICATED","PERMISSION_DENIED","UNAVAILABLE","INTERNAL","ABORTED") then . else null end) // null),
          activationMessage:([.textPayload,$payload.message,$payload.error,$error.message] | any(.[] | strings; contains("Coordinated deployment has not been activated"))),
          authVerification:($checks.auth | verification),
          appCheckVerification:($checks.app | verification)
        }) | map(select(.action or .code or .activationMessage or .authVerification or .appCheckVerification))'
    }
    capture "$report/incident-app-summary.json" incident_details || true
  fi
fi
printf 'Review before sharing: %s\nKeep private unless reviewed: %s\n' "$report" "$private"
