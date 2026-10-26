import { render, screen } from '@testing-library/react';
import { ChannelCard } from '../components/ChannelCard';
import { ChannelListItem } from '../lib/api';

function makeChannel(overrides: Partial<ChannelListItem> = {}): ChannelListItem {
  return {
    id: 1,
    title: 'Test Channel',
    subtitle: 'CH 1',
    stbNumber: 1,
    imageUrl: 'https://divign0fdw3sv.cloudfront.net/logo.png',
    category: 'News',
    genres: ['news'],
    languages: ['others'],
    rangeKey: '0_199',
    ranking: 1,
    scheduleUpdatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    now: null,
    next: null,
    ...overrides,
  };
}

describe('ChannelCard', () => {
  it('renders the subtitle exactly as given, even when it is not "CH n"', () => {
    render(<ChannelCard channel={makeChannel({ subtitle: 'Astro GO Channel' })} />);
    expect(screen.getByText('Astro GO Channel')).toBeInTheDocument();
  });

  it('shows a quiet "Schedule not available" when now and next are both null', () => {
    render(<ChannelCard channel={makeChannel({ now: null, next: null })} />);
    expect(screen.getByText('Schedule not available')).toBeInTheDocument();
    expect(screen.queryByText(/Now:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Next:/)).not.toBeInTheDocument();
  });

  it('shows the now show title and the next show when present', () => {
    render(
      <ChannelCard
        channel={makeChannel({
          now: { title: 'Show A', start: '2026-01-01T08:00:00+08:00', end: '2026-01-01T09:00:00+08:00' },
          next: { title: 'Show B', start: '2026-01-01T09:00:00+08:00', end: '2026-01-01T10:00:00+08:00' },
        })}
      />,
    );
    expect(screen.getByText('Show A')).toBeInTheDocument();
    expect(screen.getByText(/Show B/)).toBeInTheDocument();
    expect(screen.queryByText('Schedule not available')).not.toBeInTheDocument();
  });

  it('shows the title as the full-text title attribute for the two-line clamp', () => {
    render(<ChannelCard channel={makeChannel({ title: 'A Very Long Channel Title That Gets Clamped' })} />);
    expect(screen.getByText('A Very Long Channel Title That Gets Clamped')).toHaveAttribute(
      'title',
      'A Very Long Channel Title That Gets Clamped',
    );
  });
});
