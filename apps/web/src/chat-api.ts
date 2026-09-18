export async function chatApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-kenza-request': '1' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? path.startsWith('/merchant')
          ? 'Votre session commerçant a expiré. Reconnectez-vous.'
          : 'Votre session a expiré. Sélectionnez à nouveau votre profil.'
        : data.message || 'Le service est momentanément indisponible.',
    );
  return data as T;
}
