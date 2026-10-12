/// <reference types="vitest/globals" />
import { TestBed } from '@angular/core/testing';
import { FIRESTORE, FIRESTORE_OPS, FirestoreOps } from '../shared/firebase.token';
import { TagService } from './tag.service';
import type { Firestore } from 'firebase/firestore';

describe('TagService', () => {
  let service: TagService;
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
        TagService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: FIRESTORE_OPS, useValue: ops as unknown as FirestoreOps },
      ],
    });

    service = TestBed.inject(TagService);
  });

  describe('service injection', () => {
    it('should be created', () => {
      expect(service).toBeInstanceOf(TagService);
    });
  });

  describe('getAllTags', () => {
    it('should query tags ordered by name and map docs to Tag objects', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          { id: 't1', data: () => ({ name: 'Vintage', slug: 'vintage' }) },
          { id: 't2', data: () => ({ name: 'Analog', slug: 'analog' }) },
        ],
      });

      const result = await service.getAllTags();

      expect(ops.collection).toHaveBeenCalledWith(firestore, 'tags');
      expect(ops.orderBy).toHaveBeenCalledWith('name');
      expect(result).toEqual([
        { id: 't1', name: 'Vintage', slug: 'vintage' },
        { id: 't2', name: 'Analog', slug: 'analog' },
      ]);
    });

    it('should return [] when there are no docs', async () => {
      ops.getDocs.mockResolvedValueOnce({ docs: [] });
      expect(await service.getAllTags()).toEqual([]);
    });
  });

  describe('getTagById', () => {
    it('should return the tag when the snapshot exists', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 't1',
        data: () => ({ name: 'Vintage', slug: 'vintage' }),
      });

      const result = await service.getTagById('t1');

      expect(ops.doc).toHaveBeenCalledWith(firestore, 'tags', 't1');
      expect(result).toEqual({ id: 't1', name: 'Vintage', slug: 'vintage' });
    });

    it('should throw when the snapshot does not exist', async () => {
      ops.getDoc.mockResolvedValueOnce({ exists: () => false });
      await expect(service.getTagById('missing')).rejects.toThrow(
        'Tag with id "missing" not found',
      );
    });
  });

  describe('createTag', () => {
    it('should write only name and slug and return the new doc id', async () => {
      ops.addDoc.mockResolvedValueOnce({ id: 'new-id' });

      const result = await service.createTag({ name: 'Retro', slug: 'retro' });

      expect(ops.addDoc).toHaveBeenCalledWith(
        { __collection: 'tags' },
        { name: 'Retro', slug: 'retro' },
      );
      expect(result).toBe('new-id');
    });

    it('should propagate addDoc errors', async () => {
      ops.addDoc.mockRejectedValueOnce(new Error('quota'));
      await expect(service.createTag({ name: 'X', slug: 'x' })).rejects.toThrow('quota');
    });
  });

  describe('updateTag', () => {
    it('should strip id, then propagate the new name/slug into episodes that embed it', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 't1',
        data: () => ({ name: 'Updated', slug: 'updated' }),
      });
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            ref: { __ref: 'ep1' },
            data: () => ({
              tags: [
                { id: 't1', name: 'Old', slug: 'old' },
                { id: 't2', name: 'Cult', slug: 'cult' },
              ],
            }),
          },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ tags: [] }) },
        ],
      });
      const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValue(batch);

      await service.updateTag('t1', { id: 't1', name: 'Updated', slug: 'updated' });

      expect(ops.updateDoc).toHaveBeenCalledWith(
        { __doc: 'tags/t1' },
        { name: 'Updated', slug: 'updated' },
      );
      expect(batch.update).toHaveBeenCalledTimes(1);
      expect(batch.update).toHaveBeenCalledWith(
        { __ref: 'ep1' },
        {
          tags: [
            { id: 't1', name: 'Updated', slug: 'updated' },
            { id: 't2', name: 'Cult', slug: 'cult' },
          ],
        },
      );
    });

    it('should propagate updateDoc errors', async () => {
      ops.updateDoc.mockRejectedValueOnce(new Error('not-found'));
      await expect(service.updateTag('t1', { name: 'X' })).rejects.toThrow('not-found');
    });
  });

  describe('deleteTag', () => {
    it('should remove the embedded tag from episodes then delete the tag doc', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            ref: { __ref: 'ep1' },
            data: () => ({
              tags: [
                { id: 't1', name: 'Retro', slug: 'retro' },
                { id: 't2', name: 'Cult', slug: 'cult' },
              ],
            }),
          },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ tags: [] }) },
        ],
      });
      const batch = {
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      ops.writeBatch.mockReturnValue(batch);

      await service.deleteTag('t1');

      expect(batch.update).toHaveBeenCalledTimes(1);
      expect(batch.update).toHaveBeenCalledWith(
        { __ref: 'ep1' },
        { tags: [{ id: 't2', name: 'Cult', slug: 'cult' }] },
      );
      expect(batch.delete).toHaveBeenCalledWith({ __doc: 'tags/t1' });
    });

    it('should still delete the tag when no episode embeds it', async () => {
      ops.getDocs.mockResolvedValueOnce({ docs: [] });
      const batch = {
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      ops.writeBatch.mockReturnValue(batch);

      await service.deleteTag('t1');

      expect(batch.update).not.toHaveBeenCalled();
      expect(batch.delete).toHaveBeenCalledWith({ __doc: 'tags/t1' });
    });
  });

  describe('setEpisodesForTag', () => {
    it('should add the tag to newly-selected episodes and remove it from deselected ones', async () => {
      const tag = { id: 't1', name: 'Retro', slug: 'retro' };
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          { id: 'ep1', ref: { __ref: 'ep1' }, data: () => ({ tags: [tag] }) },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ tags: [] }) },
          { id: 'ep3', ref: { __ref: 'ep3' }, data: () => ({ tags: [tag] }) }, // already correct
          { id: 'ep4', ref: { __ref: 'ep4' }, data: () => ({}) }, // missing field
        ],
      });
      const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValue(batch);

      await service.setEpisodesForTag(tag, ['ep2', 'ep3']);

      expect(batch.update).toHaveBeenCalledTimes(2);
      expect(batch.update).toHaveBeenCalledWith({ __ref: 'ep1' }, { tags: [] });
      expect(batch.update).toHaveBeenCalledWith({ __ref: 'ep2' }, { tags: [tag] });
    });

    it('should do nothing when the tag has no id', async () => {
      await service.setEpisodesForTag({ name: 'X', slug: 'x' }, ['ep1']);
      expect(ops.getDocs).not.toHaveBeenCalled();
    });
  });
});
