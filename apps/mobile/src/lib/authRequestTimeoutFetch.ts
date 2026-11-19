export function createAuthRequestTimeoutFetch(
  fetchImplementation: typeof fetch = fetch,
  timeoutMs = 15_000,
): typeof fetch {
  return async (input, init) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(requestUrl);
    const isPasswordSignIn =
      url.pathname.endsWith('/auth/v1/token') &&
      url.searchParams.get('grant_type') === 'password';

    if (!isPasswordSignIn) {
      return fetchImplementation(input, init);
    }

    const controller = new AbortController();
    const requestSignal =
      init?.signal ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    const forwardAbort = () => controller.abort();
    if (requestSignal?.aborted) {
      controller.abort();
    } else {
      requestSignal?.addEventListener('abort', forwardAbort, { once: true });
    }

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetchImplementation(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        throw new Error('Sign-in timed out. Check your connection and try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener('abort', forwardAbort);
    }
  };
}
