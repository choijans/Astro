import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from '../components/SearchBar';

describe('SearchBar', () => {
  it('debounces typing: onChange fires once after typing stops, not once per keystroke', async () => {
    const onChange = jest.fn();
    render(<SearchBar value="" onChange={onChange} />);
    const input = screen.getByLabelText(/search channels/i);

    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });

    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 1000 });
    expect(onChange).toHaveBeenCalledWith('abc');
  });

  it('clears the search immediately with one click, not waiting for the debounce', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(<SearchBar value="hello" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /clear search/i }));

    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByLabelText(/search channels/i)).toHaveValue('');
  });

  it('is a labelled input', () => {
    render(<SearchBar value="" onChange={jest.fn()} />);
    expect(screen.getByLabelText(/search channels/i)).toBeInTheDocument();
  });
});
