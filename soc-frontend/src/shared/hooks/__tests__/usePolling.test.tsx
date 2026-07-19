import { renderHook, waitFor } from '@testing-library/react';
import { usePolling } from '../usePolling';
import apiClient from '../../api/apiClient';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/apiClient', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('usePolling Path Tests', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('Path 1: Successfully fetches data and calls onData', async () => {
    const mockData = { test: 'data' };
    (apiClient.get as any).mockResolvedValueOnce({ data: mockData });

    const onData = vi.fn();
    const onError = vi.fn();

    renderHook(() => usePolling('/test-url', 1000, onData, onError));

    // Fast-forward initial async fetch
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
    expect(onData).toHaveBeenCalledWith(mockData);
    expect(onError).not.toHaveBeenCalled();
  });

  it('Path 2: Encounters an error and calls onError', async () => {
    const mockError = new Error('Network failure');
    (apiClient.get as any).mockRejectedValueOnce(mockError);

    const onData = vi.fn();
    const onError = vi.fn();

    renderHook(() => usePolling('/test-url', 1000, onData, onError));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(mockError);
    expect(onData).not.toHaveBeenCalled();
  });

  it('Path 3: Safely ignores CanceledError during unmount', async () => {
    const cancelError = new Error('canceled');
    cancelError.name = 'CanceledError';
    (apiClient.get as any).mockRejectedValueOnce(cancelError);

    const onData = vi.fn();
    const onError = vi.fn();

    renderHook(() => usePolling('/test-url', 1000, onData, onError));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
    
    // CanceledErrors should NOT trigger onError
    expect(onError).not.toHaveBeenCalled();
  });

  it('Path 4: Recursively polls at the specified interval', async () => {
    vi.useFakeTimers();
    (apiClient.get as any).mockResolvedValue({ data: {} });
    
    const onData = vi.fn();
    renderHook(() => usePolling('/test-url', 1000, onData));

    // The first fetch is called immediately on mount
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    
    // Advance timer to trigger next poll and flush microtasks
    await vi.advanceTimersByTimeAsync(1000);
    expect(apiClient.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });
});
