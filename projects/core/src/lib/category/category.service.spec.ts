/// <reference types="vitest/globals" />
import { TestBed } from '@angular/core/testing';
import { FIRESTORE, FIRESTORE_OPS, FirestoreOps } from '../shared/firebase.token';
import { CategoryService } from './category.service';
import type { Firestore } from 'firebase/firestore';

describe('CategoryService', () => {
  let service: CategoryService;
  let ops: { [K in keyof FirestoreOps]: ReturnType<typeof vi.fn> };
  const firestore = { __brand: 'fake-firestore' } as unknown as Firestore;

  beforeEach(() => {
    ops = {
      collection: vi.fn((_db, path) => ({ __collection: path })),
      doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
      query: vi.fn((coll, ...constraints) => ({ __query: { coll, constraints } })),
      orderBy: vi.fn((field) => ({ __orderBy: field })),
      documentId: vi.fn(() => '__name__'),
      where: vi.fn((field, op, value) => ({ __where: { field, op, value } })),
      limit: vi.fn((n) => ({ __limit: n })),
      getDoc: vi.fn(),
      getDocs: vi.fn(),
      getCountFromServer: vi.fn(),
      addDoc: vi.fn(),
      updateDoc: vi.fn().mockResolvedValue(undefined),
      writeBatch: vi.fn(),
      Timestamp: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        CategoryService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: FIRESTORE_OPS, useValue: ops as unknown as FirestoreOps },
      ],
    });

    service = TestBed.inject(CategoryService);
  });

  describe('service injection', () => {
    it('should be created', () => {
      expect(service).toBeInstanceOf(CategoryService);
    });
  });

  describe('getAllCategories', () => {
    it('should query the categories collection ordered by name and map docs to Category objects', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          { id: 'c1', data: () => ({ name: 'History', slug: 'history' }) },
          { id: 'c2', data: () => ({ name: 'Science', slug: 'science' }) },
        ],
      });

      const result = await service.getAllCategories();

      expect(ops.collection).toHaveBeenCalledWith(firestore, 'categories');
      expect(ops.orderBy).toHaveBeenCalledWith('name');
      expect(ops.query).toHaveBeenCalledTimes(1);
      expect(ops.getDocs).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { id: 'c1', name: 'History', slug: 'history' },
        { id: 'c2', name: 'Science', slug: 'science' },
      ]);
    });

    it('should return an empty array when there are no docs', async () => {
      ops.getDocs.mockResolvedValueOnce({ docs: [] });

      const result = await service.getAllCategories();

      expect(result).toEqual([]);
    });

    it('should propagate errors from getDocs', async () => {
      ops.getDocs.mockRejectedValueOnce(new Error('firestore unavailable'));

      await expect(service.getAllCategories()).rejects.toThrow('firestore unavailable');
    });
  });

  describe('getCategoryById', () => {
    it('should return the category when the snapshot exists', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'c1',
        data: () => ({ name: 'History', slug: 'history' }),
      });

      const result = await service.getCategoryById('c1');

      expect(ops.doc).toHaveBeenCalledWith(firestore, 'categories', 'c1');
      expect(result).toEqual({ id: 'c1', name: 'History', slug: 'history' });
    });

    it('should throw when the snapshot does not exist', async () => {
      ops.getDoc.mockResolvedValueOnce({ exists: () => false });

      await expect(service.getCategoryById('missing')).rejects.toThrow(
        'Category with id "missing" not found',
      );
    });

    it('should propagate errors from getDoc', async () => {
      ops.getDoc.mockRejectedValueOnce(new Error('permission-denied'));

      await expect(service.getCategoryById('c1')).rejects.toThrow('permission-denied');
    });
  });

  describe('createCategory', () => {
    it('should write only name and slug and return the new doc id', async () => {
      ops.addDoc.mockResolvedValueOnce({ id: 'new-id' });

      const result = await service.createCategory({ name: 'Tech', slug: 'tech' });

      expect(ops.collection).toHaveBeenCalledWith(firestore, 'categories');
      expect(ops.addDoc).toHaveBeenCalledWith(
        { __collection: 'categories' },
        { name: 'Tech', slug: 'tech' },
      );
      expect(result).toBe('new-id');
    });

    it('should ignore extra fields on the input object', async () => {
      ops.addDoc.mockResolvedValueOnce({ id: 'new-id' });

      await service.createCategory({
        name: 'Tech',
        slug: 'tech',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extraneous: 'should-be-stripped',
      } as any);

      expect(ops.addDoc).toHaveBeenCalledWith(expect.anything(), {
        name: 'Tech',
        slug: 'tech',
      });
    });

    it('should propagate errors from addDoc', async () => {
      ops.addDoc.mockRejectedValueOnce(new Error('quota exceeded'));

      await expect(service.createCategory({ name: 'X', slug: 'x' })).rejects.toThrow(
        'quota exceeded',
      );
    });
  });

  describe('updateCategory', () => {
    it('should strip id, then propagate the new name/slug into episodes that embed it', async () => {
      // getCategoryById re-read after the doc update.
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'c1',
        data: () => ({ name: 'Updated', slug: 'updated' }),
      });
      // Episode scan: ep1 embeds c1 alongside c2 (untouched); ep2 does not embed c1.
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            ref: { __ref: 'ep1' },
            data: () => ({
              categories: [
                { id: 'c1', name: 'Old', slug: 'old' },
                { id: 'c2', name: 'Science', slug: 'science' },
              ],
            }),
          },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ categories: [] }) },
        ],
      });
      const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValue(batch);

      await service.updateCategory('c1', { id: 'c1', name: 'Updated', slug: 'updated' });

      expect(ops.updateDoc).toHaveBeenCalledWith(
        { __doc: 'categories/c1' },
        { name: 'Updated', slug: 'updated' },
      );
      expect(batch.update).toHaveBeenCalledTimes(1);
      expect(batch.update).toHaveBeenCalledWith(
        { __ref: 'ep1' },
        {
          categories: [
            { id: 'c1', name: 'Updated', slug: 'updated' },
            { id: 'c2', name: 'Science', slug: 'science' },
          ],
        },
      );
    });

    it('should pass an empty payload through when only the id is supplied', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'c1',
        data: () => ({ name: 'History', slug: 'history' }),
      });
      ops.getDocs.mockResolvedValueOnce({ docs: [] });

      await service.updateCategory('c1', { id: 'c1' });

      expect(ops.updateDoc).toHaveBeenCalledWith({ __doc: 'categories/c1' }, {});
    });

    it('should propagate errors from updateDoc', async () => {
      ops.updateDoc.mockRejectedValueOnce(new Error('not-found'));

      await expect(service.updateCategory('c1', { name: 'X' })).rejects.toThrow('not-found');
    });
  });

  describe('deleteCategory', () => {
    it('should remove the embedded category from episodes then delete the category doc', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            ref: { __ref: 'ep1' },
            data: () => ({
              categories: [
                { id: 'c1', name: 'History', slug: 'history' },
                { id: 'c2', name: 'Science', slug: 'science' },
              ],
            }),
          },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ categories: [] }) },
        ],
      });
      const batch = {
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      ops.writeBatch.mockReturnValue(batch);

      await service.deleteCategory('c1');

      // ep1 rewritten without c1; ep2 untouched.
      expect(batch.update).toHaveBeenCalledTimes(1);
      expect(batch.update).toHaveBeenCalledWith(
        { __ref: 'ep1' },
        { categories: [{ id: 'c2', name: 'Science', slug: 'science' }] },
      );
      expect(batch.delete).toHaveBeenCalledWith({ __doc: 'categories/c1' });
    });

    it('should still delete the category doc when no episode embeds it', async () => {
      ops.getDocs.mockResolvedValueOnce({ docs: [] });
      const batch = {
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      ops.writeBatch.mockReturnValue(batch);

      await service.deleteCategory('c1');

      expect(batch.update).not.toHaveBeenCalled();
      expect(batch.delete).toHaveBeenCalledWith({ __doc: 'categories/c1' });
      expect(batch.commit).toHaveBeenCalledTimes(1);
    });
  });

  describe('setEpisodesForCategory', () => {
    it('should add the category to newly-selected episodes and remove it from deselected ones', async () => {
      const category = { id: 'c1', name: 'History', slug: 'history' };
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          { id: 'ep1', ref: { __ref: 'ep1' }, data: () => ({ categories: [category] }) },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ categories: [] }) },
          { id: 'ep3', ref: { __ref: 'ep3' }, data: () => ({ categories: [category] }) },
          // No `categories` field at all — exercises the default-to-empty path.
          { id: 'ep4', ref: { __ref: 'ep4' }, data: () => ({}) },
        ],
      });
      const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValue(batch);

      // Target: ep2 and ep3 should carry the category.
      await service.setEpisodesForCategory(category, ['ep2', 'ep3']);

      // ep1 removed, ep2 added, ep3 unchanged, ep4 untouched.
      expect(batch.update).toHaveBeenCalledTimes(2);
      expect(batch.update).toHaveBeenCalledWith({ __ref: 'ep1' }, { categories: [] });
      expect(batch.update).toHaveBeenCalledWith({ __ref: 'ep2' }, { categories: [category] });
    });

    it('should do nothing when the category has no id', async () => {
      await service.setEpisodesForCategory({ name: 'X', slug: 'x' }, ['ep1']);
      expect(ops.getDocs).not.toHaveBeenCalled();
    });
  });
});
