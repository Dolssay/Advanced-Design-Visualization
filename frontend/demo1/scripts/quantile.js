// k-th smallest value (0-based), partly reordering `values` in place (quickselect).
export function select(values, k) {
  let lo = 0;
  let hi = values.length - 1;
  while (hi > lo) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const swap = values[i];
        values[i++] = values[j];
        values[j--] = swap;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break; // values between j and i all equal the pivot
  }
  return values[k];
}

// Same linear interpolation as reading a sorted array, without sorting 1M values.
export function quantile(values, q) {
  if (!values.length) return NaN;
  const position = (values.length - 1) * q;
  const low = Math.floor(position);
  const lowValue = select(values, low);
  const high = Math.ceil(position);
  return lowValue + (select(values, high) - lowValue) * (position - low);
}
