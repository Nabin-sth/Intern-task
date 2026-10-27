/**
 * Try mock providers in priority order. Skip (and record) routes whose
 * balance is below the number of SMS parts. Provider I/O stays outside
 * any MongoDB transaction.
 */
export async function sendWithFailover({ to, body, parts, providers }) {
  const ordered = [...providers].sort((a, b) => a.priority - b.priority);
  const attempts = [];

  for (const provider of ordered) {
    const balance = await provider.getBalance();
    if (balance < parts) {
      attempts.push({
        providerName: provider.name,
        success: false,
        error: 'insufficient_balance',
        attemptedAt: new Date(),
      });
      continue;
    }

    const result = await provider.send({ to, body, parts });
    attempts.push({
      providerName: result.providerName,
      success: result.success,
      error: result.error,
      attemptedAt: new Date(),
    });

    if (result.success) {
      return {
        success: true,
        sentVia: result.providerName,
        attempts,
      };
    }
  }

  return {
    success: false,
    sentVia: null,
    attempts,
  };
}
