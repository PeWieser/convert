/** Begrenzt die Zahl gleichzeitig laufender asynchroner Aufgaben. */
export function createLimiter(getLimit: number | (() => number)) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const limit = () => Math.max(1, typeof getLimit === "function" ? getLimit() : getLimit);

  const next = () => {
    while (active < limit() && waiting.length) {
      active++;
      waiting.shift()!();
    }
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        Promise.resolve().then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
