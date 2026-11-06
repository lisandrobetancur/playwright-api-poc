import type { APIResponse } from '@playwright/test';
import { BaseClient } from './base.client';
import type { NewPost, Post } from '../types/post';

export class PostsClient extends BaseClient {
  private readonly path = '/posts';

  list(params?: Record<string, string | number>): Promise<APIResponse> {
    return this.request.get(this.path, { params });
  }

  getById(id: number): Promise<APIResponse> {
    return this.request.get(`${this.path}/${id}`);
  }

  create(data: NewPost): Promise<APIResponse> {
    return this.request.post(this.path, { data });
  }

  update(id: number, data: Partial<Post>): Promise<APIResponse> {
    return this.request.patch(`${this.path}/${id}`, { data });
  }

  delete(id: number): Promise<APIResponse> {
    return this.request.delete(`${this.path}/${id}`);
  }
}
