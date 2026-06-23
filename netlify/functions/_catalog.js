// netlify/functions/_catalog.js
//
// Server-side source of truth for prices. The browser only ever sends
// item IDs + quantities — never trust client-supplied prices directly,
// since anyone can open devtools and rewrite the JS. We look up the
// real price here on every checkout/order request.
//
// IMPORTANT: keep these values in sync with the prices shown in index.html.

const CATALOG = {
  main: {
    name: "Himalayan Shilajit 45g (Buy 1 Get 1 Free)",
    unitPrice: 94.5, // EUR
    maxQty: 10,
  },
  "upsell-power": {
    name: "Performance Pack — Add 2 Extra Shilajit Jars",
    unitPrice: 39,
    maxQty: 1,
  },
  "upsell-sentuel": {
    name: "PeakModo Sentuel™ — Premium Ashwagandha Formula, 3er Pack",
    unitPrice: 149,
    maxQty: 1,
  },
};

// Validates and normalizes the `items` array sent from the cart.
// Returns { lineItems, totalEUR } where each lineItem has
// { id, name, unitPrice, quantity }. Throws on any invalid input.
function resolveLineItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("Cart is empty.");
  }

  const lineItems = rawItems.map((raw) => {
    const catalogEntry = CATALOG[raw && raw.id];
    if (!catalogEntry) {
      throw new Error(`Unknown item: ${raw && raw.id}`);
    }
    const quantity = Math.min(
      Math.max(parseInt(raw.quantity, 10) || 1, 1),
      catalogEntry.maxQty
    );
    return {
      id: raw.id,
      name: catalogEntry.name,
      unitPrice: catalogEntry.unitPrice,
      quantity,
    };
  });

  const totalEUR = lineItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  return { lineItems, totalEUR };
}

module.exports = { CATALOG, resolveLineItems };
