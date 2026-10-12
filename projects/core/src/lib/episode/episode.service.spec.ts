/// <reference types="vitest/globals" />
import { TestBed } from '@angular/core/testing';
import { FIRESTORE, FIRESTORE_OPS, FirestoreOps } from '../shared/firebase.token';
import { CategoryService } from '../category/category.service';
import { GenreService } from '../genre/genre.service';
import { TagService } from '../tag/tag.service';
import { EpisodeService } from './episode.service';
import type { Firestore } from 'firebase/firestore';

describe('EpisodeService', () => {
  let service: EpisodeService;
  let ops: { [K in keyof FirestoreOps]: ReturnType<typeof vi.fn> };
  const firestore = { __brand: 'fake-firestore' } as unknown as Firestore;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCategoryService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGenreService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTagService: any;

  beforeEach(() => {
    let autoIdCounter = 0;
    ops = {
      collection: vi.fn((_db, path) => ({ __collection: path })),
      doc: vi.fn((arg1, arg2, arg3) => {
        if (arg2 === undefined) {
          autoIdCounter += 1;
          return {
            id: `auto-${autoIdCounter}`,
            __collection: (arg1 as { __collection?: string }).__collection,
          };
        }
        return { __doc: `${arg2}/${arg3}` };
      }),
      query: vi.fn((coll, ...constraints) => ({ __query: { coll, constraints } })),
      orderBy: vi.fn((field, dir) => ({ __orderBy: { field, dir } })),
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

    mockCategoryService = {
      getAllCategories: vi.fn().mockResolvedValue([
        { id: 'c1', name: 'History', slug: 'history' },
        { id: 'c2', name: 'Science', slug: 'science' },
      ]),
    };
    mockGenreService = {
      getAllGenres: vi.fn().mockResolvedValue([{ id: 'g1', name: 'Action', slug: 'action' }]),
    };
    mockTagService = {
      getAllTags: vi.fn().mockResolvedValue([{ id: 't1', name: 'Featured', slug: 'featured' }]),
    };

    TestBed.configureTestingModule({
      providers: [
        EpisodeService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: FIRESTORE_OPS, useValue: ops as unknown as FirestoreOps },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: GenreService, useValue: mockGenreService },
        { provide: TagService, useValue: mockTagService },
      ],
    });

    service = TestBed.inject(EpisodeService);
  });

  describe('getHomeEpisodes', () => {
    it('should bundle episodes, total, and the first episode as featured', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            data: () => ({
              title: 'Featured',
              categories: [{ id: 'c1', name: 'History', slug: 'history' }],
              genres: [{ id: 'g1', name: 'Action', slug: 'action' }],
              tags: [{ id: 't1', name: 'Featured', slug: 'featured' }],
            }),
          },
          { id: 'ep2', data: () => ({ title: 'Second' }) },
        ],
      });
      ops.getCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 12 }) });

      const result = await service.getHomeEpisodes();

      expect(ops.limit).toHaveBeenCalledWith(9);
      expect(result.total).toBe(12);
      expect(result.episodes.map((e) => e.id)).toEqual(['ep1', 'ep2']);
      expect(result.featured).toEqual({
        id: 'ep1',
        title: 'Featured',
        categories: [{ id: 'c1', name: 'History', slug: 'history' }],
        genres: [{ id: 'g1', name: 'Action', slug: 'action' }],
        tags: [{ id: 't1', name: 'Featured', slug: 'featured' }],
      });
      // A doc without embedded arrays still normalizes to empty arrays.
      expect(result.episodes[1]).toEqual({
        id: 'ep2',
        title: 'Second',
        categories: [],
        genres: [],
        tags: [],
      });
    });

    it('should return featured=null when there are no episodes', async () => {
      ops.getDocs.mockResolvedValueOnce({ docs: [] });
      ops.getCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 0 }) });

      const result = await service.getHomeEpisodes();

      expect(result.featured).toBeNull();
      expect(result.episodes).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getAllEpisodes', () => {
    it('should query episodes ordered by episodeDate desc and map docs with embedded taxonomy', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          { id: 'ep1', data: () => ({ title: 'One', isVisible: true }) },
          { id: 'ep2', data: () => ({ title: 'Two', isVisible: false }) },
        ],
      });

      const result = await service.getAllEpisodes();

      expect(ops.collection).toHaveBeenCalledWith(firestore, 'episodes');
      expect(ops.orderBy).toHaveBeenCalledWith('episodeDate', 'desc');
      expect(result).toEqual([
        { id: 'ep1', title: 'One', isVisible: true, categories: [], genres: [], tags: [] },
        { id: 'ep2', title: 'Two', isVisible: false, categories: [], genres: [], tags: [] },
      ]);
    });
  });

  describe('toggleEpisodeVisibility', () => {
    it('should call updateDoc with { isVisible }', async () => {
      await service.toggleEpisodeVisibility('ep1', false);

      expect(ops.updateDoc).toHaveBeenCalledWith({ __doc: 'episodes/ep1' }, { isVisible: false });
    });
  });

  describe('getVisibleEpisodeList', () => {
    it('should query visible episodes ordered by episodeDate desc', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [{ id: 'ep1', data: () => ({ title: 'A', isVisible: true }) }],
      });

      const result = await service.getVisibleEpisodeList();

      expect(ops.where).toHaveBeenCalledWith('isVisible', '==', true);
      expect(ops.orderBy).toHaveBeenCalledWith('episodeDate', 'desc');
      expect(result.map((e) => e.id)).toEqual(['ep1']);
    });

    it('should drop the intelligence field while keeping list fields and taxonomy', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            data: () => ({
              title: 'Heavy',
              isVisible: true,
              links: { spotify: 's' },
              tags: [{ id: 't1', name: 'Featured', slug: 'featured' }],
              intelligence: 'a very long markdown summary that should not be inlined into SSR',
            }),
          },
        ],
      });

      const [episode] = await service.getVisibleEpisodeList();

      expect(episode.id).toBe('ep1');
      expect(episode.title).toBe('Heavy');
      expect(episode.links).toEqual({ spotify: 's' });
      expect(episode.tags).toEqual([{ id: 't1', name: 'Featured', slug: 'featured' }]);
      expect(episode.intelligence).toBeNull();
    });
  });

  describe('shared visible-episode read', () => {
    const visibleDocs = {
      docs: [
        {
          id: 'ep1',
          data: () => ({
            title: 'A',
            isVisible: true,
            tags: [{ id: 't1', name: 'Featured', slug: 'featured' }],
            intelligence: 'long markdown',
          }),
        },
      ],
    };

    it('should serve both list methods from a single Firestore read', async () => {
      ops.getDocs.mockResolvedValue(visibleDocs);

      const items = await service.getEpisodeListItems();
      const list = await service.getVisibleEpisodeList();

      expect(ops.getDocs).toHaveBeenCalledTimes(1);
      expect(items.map((e) => e.id)).toEqual(['ep1']);
      expect(list[0].tags).toEqual([{ id: 't1', name: 'Featured', slug: 'featured' }]);
      expect(list[0].intelligence).toBeNull();
    });

    it('should share one read between concurrent callers', async () => {
      ops.getDocs.mockResolvedValue(visibleDocs);

      await Promise.all([service.getVisibleEpisodeList(), service.getEpisodeListItems()]);

      expect(ops.getDocs).toHaveBeenCalledTimes(1);
    });

    it('should not keep a failed read, so the next call reads again', async () => {
      ops.getDocs
        .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }))
        .mockResolvedValueOnce(visibleDocs);

      await expect(service.getEpisodeListItems()).rejects.toThrow('denied');
      const list = await service.getVisibleEpisodeList();

      expect(ops.getDocs).toHaveBeenCalledTimes(2);
      expect(list.map((e) => e.id)).toEqual(['ep1']);
    });
  });

  describe('getEpisodeListItems', () => {
    it('should query visible episodes ordered by episodeDate desc', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [{ id: 'ep1', data: () => ({ title: 'A', isVisible: true }) }],
      });

      const result = await service.getEpisodeListItems();

      expect(ops.where).toHaveBeenCalledWith('isVisible', '==', true);
      expect(ops.orderBy).toHaveBeenCalledWith('episodeDate', 'desc');
      expect(result.map((e) => e.id)).toEqual(['ep1']);
    });

    it('should project to id/title/episodeDate only, dropping taxonomy and intelligence', async () => {
      const episodeDate = { __ts: 1 } as unknown;
      ops.getDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'ep1',
            data: () => ({
              title: 'Heavy',
              isVisible: true,
              episodeDate,
              links: { spotify: 's' },
              categories: [{ id: 'c1', name: 'History', slug: 'history' }],
              genres: [{ id: 'g1', name: 'Action', slug: 'action' }],
              tags: [{ id: 't1', name: 'Featured', slug: 'featured' }],
              intelligence: 'a very long markdown summary that should not be inlined into SSR',
            }),
          },
        ],
      });

      const [item] = await service.getEpisodeListItems();

      expect(item).toEqual({ id: 'ep1', title: 'Heavy', episodeDate });
    });

    it('should default a missing title to an empty string', async () => {
      ops.getDocs.mockResolvedValueOnce({
        docs: [{ id: 'ep1', data: () => ({ isVisible: true }) }],
      });

      const [item] = await service.getEpisodeListItems();

      expect(item.title).toBe('');
    });
  });

  describe('getEpisodeById', () => {
    it('should throw when the snapshot does not exist', async () => {
      ops.getDoc.mockResolvedValueOnce({ exists: () => false });
      await expect(service.getEpisodeById('missing')).rejects.toThrow(
        'Episode with id "missing" not found',
      );
    });

    it('should return the episode with its embedded taxonomy', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'ep1',
        data: () => ({
          title: 'Test',
          categories: [{ id: 'c1', name: 'History', slug: 'history' }],
          genres: [{ id: 'g1', name: 'Action', slug: 'action' }],
          tags: [{ id: 't1', name: 'Featured', slug: 'featured' }],
        }),
      });

      const result = await service.getEpisodeById('ep1');

      expect(result).toEqual({
        id: 'ep1',
        title: 'Test',
        categories: [{ id: 'c1', name: 'History', slug: 'history' }],
        genres: [{ id: 'g1', name: 'Action', slug: 'action' }],
        tags: [{ id: 't1', name: 'Featured', slug: 'featured' }],
      });
    });

    it('should default missing taxonomy arrays to empty', async () => {
      ops.getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'ep1',
        data: () => ({ title: 'Legacy' }),
      });

      const result = await service.getEpisodeById('ep1');

      expect(result).toEqual({ id: 'ep1', title: 'Legacy', categories: [], genres: [], tags: [] });
    });
  });

  describe('createEpisode', () => {
    const baseEpisode = {
      createdAt: { seconds: 1, nanoseconds: 0 },
      episodeDate: { seconds: 2, nanoseconds: 0 },
      intelligence: null,
      isVisible: true,
      links: { spotify: 'https://spotify.com/ep1' },
      title: 'New Episode',
    } as never;

    it('should embed the resolved taxonomy on a single episode doc and return the new id', async () => {
      const batch = { set: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValueOnce(batch);

      const result = await service.createEpisode(baseEpisode, ['c1', 'c2'], ['g1'], ['t1']);

      expect(batch.set).toHaveBeenCalledTimes(1);
      const written = batch.set.mock.calls[0][1];
      expect(written).not.toHaveProperty('id');
      expect(written.title).toBe('New Episode');
      expect(written.categories).toEqual([
        { id: 'c1', name: 'History', slug: 'history' },
        { id: 'c2', name: 'Science', slug: 'science' },
      ]);
      expect(written.genres).toEqual([{ id: 'g1', name: 'Action', slug: 'action' }]);
      expect(written.tags).toEqual([{ id: 't1', name: 'Featured', slug: 'featured' }]);
      expect(batch.commit).toHaveBeenCalledTimes(1);
      expect(typeof result).toBe('string');
      expect(result.startsWith('auto-')).toBe(true);
    });

    it('should propagate the error when the batch commit fails', async () => {
      const batch = {
        set: vi.fn(),
        commit: vi.fn().mockRejectedValueOnce(new Error('write failed')),
      };
      ops.writeBatch.mockReturnValueOnce(batch);

      await expect(service.createEpisode(baseEpisode, [], [], [])).rejects.toThrow('write failed');
    });
  });

  describe('updateEpisode', () => {
    it('should update the episode doc with the supplied fields stripped of id', async () => {
      await service.updateEpisode('ep1', { id: 'ep1', title: 'Updated' });

      expect(ops.updateDoc).toHaveBeenCalledWith({ __doc: 'episodes/ep1' }, { title: 'Updated' });
    });

    it('should embed re-resolved taxonomy when selections are provided', async () => {
      await service.updateEpisode('ep1', { title: 'X' }, ['c1'], ['g1'], []);

      expect(ops.updateDoc).toHaveBeenCalledWith(
        { __doc: 'episodes/ep1' },
        {
          title: 'X',
          categories: [{ id: 'c1', name: 'History', slug: 'history' }],
          genres: [{ id: 'g1', name: 'Action', slug: 'action' }],
          tags: [],
        },
      );
    });

    it('should re-embed only the taxonomy arrays whose ids were supplied', async () => {
      // Only genres provided — categories/tags must be left untouched on the doc.
      await service.updateEpisode('ep1', { title: 'X' }, undefined, ['g1'], undefined);

      expect(ops.updateDoc).toHaveBeenCalledWith(
        { __doc: 'episodes/ep1' },
        { title: 'X', genres: [{ id: 'g1', name: 'Action', slug: 'action' }] },
      );
    });
  });

  describe('deleteEpisode', () => {
    it('should delete only the episode doc', async () => {
      const batch = { delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
      ops.writeBatch.mockReturnValueOnce(batch);

      await service.deleteEpisode('ep1');

      expect(batch.delete).toHaveBeenCalledTimes(1);
      expect(batch.delete).toHaveBeenCalledWith({ __doc: 'episodes/ep1' });
      expect(batch.commit).toHaveBeenCalledTimes(1);
    });
  });
});
