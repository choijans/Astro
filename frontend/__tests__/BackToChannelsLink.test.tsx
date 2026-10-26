import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackToChannelsLink } from '../components/BackToChannelsLink';
import { LAST_CHANNELS_URL_KEY } from '../hooks/useChannelUrlState';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockClear();
  sessionStorage.clear();
});

describe('BackToChannelsLink', () => {
  it('navigates to the last-seen channel list URL (filters included) instead of using browser history', async () => {
    sessionStorage.setItem(LAST_CHANNELS_URL_KEY, '/?q=astro&sort=title&order=desc');
    const user = userEvent.setup();
    render(<BackToChannelsLink />);

    await user.click(screen.getByRole('button', { name: /Back to channels/ }));

    expect(mockPush).toHaveBeenCalledWith('/?q=astro&sort=title&order=desc');
  });

  it('falls back to "/" when no list URL was recorded, e.g. the details page was opened directly', async () => {
    const user = userEvent.setup();
    render(<BackToChannelsLink />);

    await user.click(screen.getByRole('button', { name: /Back to channels/ }));

    expect(mockPush).toHaveBeenCalledWith('/');
  });
});
