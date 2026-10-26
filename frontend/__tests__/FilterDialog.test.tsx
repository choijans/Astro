import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterDialog } from '../components/FilterDialog';
import { useChannelFiltersQuery } from '../hooks/useChannelFiltersQuery';

jest.mock('../hooks/useChannelFiltersQuery');

const mockFilterOptions = {
  categories: ['Sports', 'News'],
  languages: ['malay', 'chinese'],
  genres: ['sports', 'news'],
};

// jsdom doesn't implement <dialog>'s showModal()/close() — polyfilled minimally
// so the component's imperative calls don't throw. Escape-to-close is a
// browser-native behavior jsdom doesn't implement either; the Escape test
// below triggers the same 'close' event the browser would fire, to verify
// our handler reacts correctly to it.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  (useChannelFiltersQuery as jest.Mock).mockReturnValue({ data: mockFilterOptions });
});

describe('FilterDialog', () => {
  it('stages a selection and only calls onApply (writing the URL) when Apply is clicked', async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    render(
      <FilterDialog
        open
        current={{ category: '', language: '', genre: '' }}
        onClose={jest.fn()}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Sports' }));
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ category: 'Sports', language: '', genre: '' });
  });

  it('X closes without applying the staged selection', async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(
      <FilterDialog open current={{ category: '', language: '', genre: '' }} onClose={onClose} onApply={onApply} />,
    );

    await user.click(screen.getByRole('button', { name: 'Sports' }));
    await user.click(screen.getByRole('button', { name: 'Close filters' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape (the dialog firing its native close event) closes without applying', async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(
      <FilterDialog open current={{ category: '', language: '', genre: '' }} onClose={onClose} onApply={onApply} />,
    );

    await user.click(screen.getByRole('button', { name: 'Sports' }));
    screen.getByRole('dialog', { hidden: true }).dispatchEvent(new Event('close'));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Reset clears the staged selections without closing the dialog', async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(
      <FilterDialog
        open
        current={{ category: 'Sports', language: '', genre: '' }}
        onClose={onClose}
        onApply={onApply}
      />,
    );

    expect(screen.getByRole('button', { name: 'Sports' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Sports' })).toHaveAttribute('aria-pressed', 'false');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ category: '', language: '', genre: '' });
  });

  it('re-stages from current every time it freshly opens', () => {
    const { rerender } = render(
      <FilterDialog
        open={false}
        current={{ category: 'Sports', language: '', genre: '' }}
        onClose={jest.fn()}
        onApply={jest.fn()}
      />,
    );

    rerender(
      <FilterDialog
        open
        current={{ category: 'Sports', language: '', genre: '' }}
        onClose={jest.fn()}
        onApply={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Sports' })).toHaveAttribute('aria-pressed', 'true');
  });
});
