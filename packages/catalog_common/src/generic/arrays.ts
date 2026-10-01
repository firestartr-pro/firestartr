export function removeRepeatedObjectsFromArrayByProp<T>(
  array: T[],
  propiedad: keyof T,
): T[] {
  const uniqueSet = new Set(array.map((item) => item[propiedad]));
  return array.filter((item) => uniqueSet.has(item[propiedad]));
}
