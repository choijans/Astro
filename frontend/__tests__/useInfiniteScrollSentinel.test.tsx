import { render } from '@testing-library/react';
import { useInfiniteScrollSentinel } from '../hooks/useInfiniteScrollSentinel';

type Params = Parameters<typeof useInfiniteScrollSentinel>[0];

function TestSentinel(props: Params) {
  const ref = useInfiniteScrollSentinel(props);
  return <div ref={ref} data-testid="sentinel" />;
}

describe('useInfiniteScrollSentinel', () => {
  let observeMock: jest.Mock;
  let disconnectMock: jest.Mock;
  let capturedCallback: IntersectionObserverCallback = () => {};

  beforeEach(() => {
    observeMock = jest.fn();
    disconnectMock = jest.fn();
    (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = jest.fn(
      (callback: IntersectionObserverCallback) => {
        capturedCallback = callback;
        return { observe: observeMock, disconnect: disconnectMock, unobserve: jest.fn() };
      },
    );
  });

  it('observes the sentinel and calls onLoadMore when it intersects', () => {
    const onLoadMore = jest.fn();
    render(<TestSentinel hasNextPage onLoadMore={onLoadMore} isFetchingNextPage={false} />);

    expect(observeMock).toHaveBeenCalledTimes(1);

    capturedCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('never observes the sentinel when hasNextPage is false', () => {
    const onLoadMore = jest.fn();
    render(<TestSentinel hasNextPage={false} onLoadMore={onLoadMore} isFetchingNextPage={false} />);

    expect(observeMock).not.toHaveBeenCalled();
  });

  it('does not call onLoadMore again while already fetching the next page', () => {
    const onLoadMore = jest.fn();
    render(<TestSentinel hasNextPage onLoadMore={onLoadMore} isFetchingNextPage />);

    capturedCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
