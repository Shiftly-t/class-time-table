const BOOKING_PHASES = new Set(['before', 'open', 'closed']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string';
const isBoolean = (value) => typeof value === 'boolean';
const isDateKey = (value) => isText(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isDateTime = (value) =>
  value === '' ||
  ((isText(value) || typeof value === 'number') && Number.isFinite(new Date(value).getTime()));
const isConfirmedCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isOptional = (value, validate) => value == null || validate(value);
const isListOf = (value, validate) => Array.isArray(value) && value.every(validate);

function isPeriod(value) {
  return isRecord(value) && isText(value.start) && isText(value.end);
}

function isCourse(value) {
  return (
    isRecord(value) &&
    isOptional(value.name, isText) &&
    isDateKey(value.startDate) &&
    isDateKey(value.endDate) &&
    isOptional(value.periods, (periods) => isListOf(periods, isPeriod))
  );
}

function isSlot(value, phase) {
  return (
    isPeriod(value) &&
    (phase === 'before' ? isOptional(value.id, isText) : isText(value.id)) &&
    isDateKey(value.date) &&
    isOptional(value.disabled, isBoolean) &&
    // An omitted capacity is unavailable for new requests, as in the original calendar.
    isOptional(value.remaining, Number.isSafeInteger)
  );
}

function isPublished(value) {
  return isRecord(value) && isText(value.slotId) && isOptional(value.subject, isText);
}

function isChange(value) {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.from) &&
    isText(value.to) &&
    isOptional(value.ack, isBoolean)
  );
}

function isBooking(value, phase) {
  if (!isRecord(value) || !isOptional(value.status, isText) || !isOptional(value.remarks, isText)) {
    return false;
  }
  // The submitted view needs all counts and lists. Other phases may omit them.
  const submitted = phase !== 'before' && value.status === 'submitted';
  const validate = (field, check) => (submitted ? check(field) : isOptional(field, check));
  return (
    validate(value.confirmedCount, isConfirmedCount) &&
    validate(value.wishes, (wishes) => isListOf(wishes, isText)) &&
    validate(value.published, (published) => isListOf(published, isPublished)) &&
    validate(value.changes, (changes) => isListOf(changes, isChange))
  );
}

export function readPublicBookingView(response) {
  if (
    !isRecord(response) ||
    !BOOKING_PHASES.has(response.phase) ||
    !isCourse(response.course) ||
    !isBooking(response.booking, response.phase) ||
    !isOptional(response.openingAt, isDateTime) ||
    !isOptional(response.slots, (slots) => isListOf(slots, (slot) => isSlot(slot, response.phase)))
  ) {
    throw new Error(
      '予約情報を確認できませんでした。再読み込みしても解決しない場合は教室へお問い合わせください。',
    );
  }
  return { ...response, slots: response.slots ?? [] };
}
