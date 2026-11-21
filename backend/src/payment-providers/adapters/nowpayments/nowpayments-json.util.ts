const LOSSLESS_NUMBER_FIELDS = new Set([
  'payment_id',
  'price_amount',
  'pay_amount',
  'amount_from',
  'estimated_amount',
  'actually_paid',
  'amount_received',
]);

export function parseLosslessNowPaymentsJson(text: string): unknown {
  const preservedNumberJson: string[] = [];
  let index = 0;
  let objectKey: string | null = null;

  while (index < text.length) {
    if (text[index] === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
        } else if (text[index++] === '"') {
          break;
        }
      }

      const token = text.slice(start, index);
      let lookahead = index;
      while (/\s/.test(text[lookahead] ?? '')) {
        lookahead++;
      }
      if (text[lookahead] === ':') {
        const key: unknown = JSON.parse(token);
        objectKey = typeof key === 'string' ? key : null;
      }
      preservedNumberJson.push(token);
      continue;
    }

    if (text[index] === ':') {
      preservedNumberJson.push(text[index++]);
      while (/\s/.test(text[index] ?? '')) {
        preservedNumberJson.push(text[index++]);
      }
      if (objectKey && LOSSLESS_NUMBER_FIELDS.has(objectKey)) {
        const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
          text.slice(index),
        )?.[0];
        if (number) {
          preservedNumberJson.push(JSON.stringify(number));
          index += number.length;
          objectKey = null;
          continue;
        }
      }
      objectKey = null;
      continue;
    }

    preservedNumberJson.push(text[index++]);
  }

  return JSON.parse(preservedNumberJson.join(''));
}
