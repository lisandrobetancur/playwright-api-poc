import type { NewPost } from '../types/post';

export function buildPost(overrides: Partial<NewPost> = {}): NewPost {
  const stamp = Date.now();
  return {
    userId: 1,
    title: `Test post ${stamp}`,
    body: `Auto-generated content ${stamp}`,
    ...overrides,
  };
}
