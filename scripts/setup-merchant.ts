import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

const path = '.env';
let contents = await readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => {
  if (e.code !== 'ENOENT') throw e;
  return '';
});
const values = parse(contents);
if (values.MERCHANT_EMAIL && values.MERCHANT_PASSWORD) {
  console.log('Le compte commerçant est déjà configuré. Identifiants inchangés.');
} else {
  const settings = {
    MERCHANT_EMAIL: values.MERCHANT_EMAIL || 'commercant@kenza.local',
    MERCHANT_PASSWORD: values.MERCHANT_PASSWORD || randomBytes(24).toString('base64url'),
  };
  for (const [key, value] of Object.entries(settings)) {
    if (values[key]) continue;
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.trimEnd()}\n${line}\n`;
  }
  await writeFile(path, contents, { mode: 0o600 });
  console.log(
    'Compte local configuré. Consultez MERCHANT_EMAIL et MERCHANT_PASSWORD dans .env. Aucun secret affiché. Redémarrez l’API pour appliquer ces valeurs.',
  );
}
