import { test, expect } from '@src/fixtures/api.fixture';
import { buildPost } from '@src/data/post.factory';
import type { Post } from '@src/types/post';

test.describe('Posts API', () => {
  test('GET /posts devuelve una lista de posts @smoke', async ({ postsClient }) => {
    const response = await postsClient.list();

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const posts: Post[] = await response.json();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        userId: expect.any(Number),
        title: expect.any(String),
        body: expect.any(String),
      }),
    );
  });

  test('GET /posts?userId filtra por usuario', async ({ postsClient }) => {
    const response = await postsClient.list({ userId: 1 });

    expect(response.ok()).toBeTruthy();
    const posts: Post[] = await response.json();
    expect(posts.every((p) => p.userId === 1)).toBe(true);
  });

  test('GET /posts/:id devuelve un post existente @smoke', async ({ postsClient }) => {
    const response = await postsClient.getById(1);

    expect(response.status()).toBe(200);
    const post: Post = await response.json();
    expect(post.id).toBe(1);
  });

  test('GET /posts/:id inexistente devuelve 404', async ({ postsClient }) => {
    const response = await postsClient.getById(999_999);
    expect(response.status()).toBe(404);
  });

  test('POST /posts crea un post', async ({ postsClient }) => {
    const payload = buildPost();
    const response = await postsClient.create(payload);

    expect(response.status()).toBe(201);
    const created: Post = await response.json();
    expect(created).toMatchObject(payload);
    expect(created.id).toEqual(expect.any(Number));
  });

  test('PATCH /posts/:id actualiza parcialmente un post', async ({ postsClient }) => {
    const response = await postsClient.update(1, { title: 'Título actualizado' });

    expect(response.status()).toBe(200);
    const updated: Post = await response.json();
    expect(updated.title).toBe('Título actualizado');
  });

  test('DELETE /posts/:id elimina un post', async ({ postsClient }) => {
    const response = await postsClient.delete(1);
    expect(response.status()).toBe(200);
  });
});
