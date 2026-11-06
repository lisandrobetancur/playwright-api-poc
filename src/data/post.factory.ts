import type { NewPost } from '../types/post';

export function buildPost(overrides: Partial<NewPost> = {}): NewPost {
  const stamp = Date.now();
  return {
    userId: 1,
    title: `Post de prueba ${stamp}`,
    body: `Contenido generado automáticamente ${stamp}`,
    ...overrides,
  };
}
