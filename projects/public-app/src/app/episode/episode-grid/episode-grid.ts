import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { Timestamp } from 'firebase/firestore';

/**
 * The grid only renders id/title/date, so it accepts any episode-like shape —
 * both the full `Episode` (explorer search results) and the slim
 * `EpisodeListItem` (the archive list). This keeps the archive's transfer-state
 * payload lean without forcing the grid to know about taxonomy.
 */
export interface EpisodeCard {
  id?: string;
  title: string;
  episodeDate: Timestamp;
}

@Component({
  selector: 'app-episode-grid',
  imports: [DatePipe, UpperCasePipe, RouterLink],
  templateUrl: './episode-grid.html',
  styleUrl: './episode-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpisodeGrid {
  readonly episodes = input<EpisodeCard[]>([]);
  readonly heading = input<string | null>(null);
  readonly ariaLabel = input<string>('Episodes');
  readonly routerPrefix = input<string>('/episodes');
  readonly loading = input<boolean>(false);

  protected readonly skeletonSlots = [0, 1, 2, 3, 4, 5];

  protected toDate(episode: EpisodeCard): Date {
    return episode.episodeDate.toDate();
  }
}
