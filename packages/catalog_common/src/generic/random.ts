import log from '../logger';

export function randomString(length = 10) {
  let result = '';
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }

  log.debug(`Generated random string ${result}`);

  return result;
}

export function shuffleArray(array: any[]): any[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function shuffleObject(obj: any, shuffleArrays = false): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj; // Return non-object values as is
  }

  if (Array.isArray(obj)) {
    if (!shuffleArrays) {
      return obj;
    }
    const shuffledArray = shuffleArray(obj);
    return shuffledArray.map((item) => shuffleObject(item));
  }

  const keys = Object.keys(obj);
  const shuffledKeys = shuffleArray(keys);

  const shuffledObj: any = {};
  shuffledKeys.forEach((key) => {
    shuffledObj[key] = shuffleObject(obj[key]);
  });

  return shuffledObj;
}
