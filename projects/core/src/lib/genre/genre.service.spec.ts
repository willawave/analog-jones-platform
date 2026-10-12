/// <reference types="vitest/globals" />
import { TestBed } from '@angular/core/testing';
import { FIRESTORE, FIRESTORE_OPS, FirestoreOps } from '../shared/firebase.token';
import { GenreService } from './genre.service';
import type { Firestore } from 'firebase/firestore';

describe('GenreService', () => {
  let service: GenreService;
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
        GenreService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: FIRESTORE_OPS, useValue: ops as unknown as FirestoreOps },
      ],
    });

    service = TestBed.inject(GenreService);
  });

  describe('service injection', () => {
    it('should be created', () => {
      expect(service).toBeInstanceOf(GenreService);
    });
  });

  describe('getAllGenres', () => {
    it('should query genres ordered by name and map docs to Genre objects', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          { id: 'g1', data: () => ({ name: 'Action', slug: 'action' }) },
          { id: 'g2', data: () => ({ name: 'Drama', slug: 'drama' }) },
        ],
      });

      const result = await service.getAllGenres();

      expect(ops.collection).toHaveBeenCalledWith(firestore, 'genres');
      expect(ops.orderBy).toHaveBeenCalledWith('name');
      expect(result).toEqual([
        { id: 'g1', name: 'Action', slug: 'action' },
        { id: 'g2', name: 'Drama', slug: 'drama' },
      ]);
    });

    it('should return [] when there are no docs', async () => {
      ops.getDocs.mockResolvedValueOnce({ docs: [] });
      expect(await service.getAllGenres()).toEqual([]);
    });

    it('should propagate getDocs errors', async () => {
      ops.getDocs.mockRejectedValueOnce(new Error('unavailable'));
      await expect(service.getAllGenres()).rejects.toThrow('unavailable');
    });
  });

  describe('getGenreById', () => {
    it('should return the genre when the snapshot exists', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'g1',
        data: () => ({ name: 'Thriller', slug: 'thriller' }),
      });

      const result = await service.getGenreById('g1');

      expect(ops.doc).toHaveBeenCalledWith(firestore, 'genres', 'g1');
      expect(result).toEqual({ id: 'g1', name: 'Thriller', slug: 'thriller' });
    });

    it('should throw when the snapshot does not exist', async () => {
      ops.getDoc.mockResolvedValueOnce({ exists: () => false });
      await expect(service.getGenreById('missing')).rejects.toThrow(
        'Genre with id "missing" not found',
      );
    });

    it('should propagate getDoc errors', async () => {
      ops.getDoc.mockRejectedValueOnce(new Error('permission-denied'));
      await expect(service.getGenreById('g1')).rejects.toThrow('permission-denied');
    });
  });

  describe('createGenre', () => {
    it('should write only name and slug and return the new doc id', async () => {
      ops.addDoc.mockResolvedValueOnce({ id: 'new-id' });

      const result = await service.createGenre({ name: 'Horror', slug: 'horror' });

      expect(ops.addDoc).toHaveBeenCalledWith(
        { __collection: 'genres' },
        { name: 'Horror', slug: 'horror' },
      );
      expect(result).toBe('new-id');
    });

    it('should propagate addDoc errors', async () => {
      ops.addDoc.mockRejectedValueOnce(new Error('quota'));
      await expect(service.createGenre({ name: 'X', slug: 'x' })).rejects.toThrow('quota');
    });
  });

  describe('updateGenre', () => {
    it('should strip id, then propagate the new name/slug into episodes that embed it', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'g1',
        data: () => ({ name: 'Updated', slug: 'updated' }),
      });
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            ref: { __ref: 'ep1' },
            data: () => ({
              genres: [
                { id: 'g1', name: 'Old', slug: 'old' },
                { id: 'g2', name: 'Drama', slug: 'drama' },
              ],
            }),
          },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ genres: [] }) },
        ],
      });
      const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValue(batch);

      await service.updateGenre('g1', { id: 'g1', name: 'Updated', slug: 'updated' });

      expect(ops.updateDoc).toHaveBeenCalledWith(
        { __doc: 'genres/g1' },
        { name: 'Updated', slug: 'updated' },
      );
      expect(batch.update).toHaveBeenCalledTimes(1);
      expect(batch.update).toHaveBeenCalledWith(
        { __ref: 'ep1' },
        {
          genres: [
            { id: 'g1', name: 'Updated', slug: 'updated' },
            { id: 'g2', name: 'Drama', slug: 'drama' },
          ],
        },
      );
    });

    it('should propagate updateDoc errors', async () => {
      ops.updateDoc.mockRejectedValueOnce(new Error('not-found'));
      await expect(service.updateGenre('g1', { name: 'X' })).rejects.toThrow('not-found');
    });
  });

  describe('deleteGenre', () => {
    it('should remove the embedded genre from episodes then delete the genre doc', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            ref: { __ref: 'ep1' },
            data: () => ({
              genres: [
                { id: 'g1', name: 'Action', slug: 'action' },
                { id: 'g2', name: 'Drama', slug: 'drama' },
              ],
            }),
          },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ genres: [] }) },
        ],
      });
      const batch = {
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      ops.writeBatch.mockReturnValue(batch);

      await service.deleteGenre('g1');

      expect(batch.update).toHaveBeenCalledTimes(1);
      expect(batch.update).toHaveBeenCalledWith(
        { __ref: 'ep1' },
        { genres: [{ id: 'g2', name: 'Drama', slug: 'drama' }] },
      );
      expect(batch.delete).toHaveBeenCalledWith({ __doc: 'genres/g1' });
    });

    it('should still delete the genre when no episode embeds it', async () => {
      ops.getDocs.mockResolvedValueOnce({ docs: [] });
      const batch = {
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      ops.writeBatch.mockReturnValue(batch);

      await service.deleteGenre('g1');

      expect(batch.update).not.toHaveBeenCalled();
      expect(batch.delete).toHaveBeenCalledWith({ __doc: 'genres/g1' });
    });
  });

  describe('setEpisodesForGenre', () => {
    it('should add the genre to newly-selected episodes and remove it from deselected ones', async () => {
      const genre = { id: 'g1', name: 'Action', slug: 'action' };
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          { id: 'ep1', ref: { __ref: 'ep1' }, data: () => ({ genres: [genre] }) },
          { id: 'ep2', ref: { __ref: 'ep2' }, data: () => ({ genres: [] }) },
          { id: 'ep3', ref: { __ref: 'ep3' }, data: () => ({ genres: [genre] }) }, // already correct
          { id: 'ep4', ref: { __ref: 'ep4' }, data: () => ({}) }, // missing field
        ],
      });
      const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValue(batch);

      await service.setEpisodesForGenre(genre, ['ep2', 'ep3']);

      expect(batch.update).toHaveBeenCalledTimes(2);
      expect(batch.update).toHaveBeenCalledWith({ __ref: 'ep1' }, { genres: [] });
      expect(batch.update).toHaveBeenCalledWith({ __ref: 'ep2' }, { genres: [genre] });
    });

    it('should do nothing when the genre has no id', async () => {
      await service.setEpisodesForGenre({ name: 'X', slug: 'x' }, ['ep1']);
      expect(ops.getDocs).not.toHaveBeenCalled();
    });
  });
});
