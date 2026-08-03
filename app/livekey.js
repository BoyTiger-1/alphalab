// Finnhub live-quote key, shipped in the public build on purpose so anyone who opens AlphaLab gets
// real-time US stock quotes with nothing to set up. This is a free key with no billing attached, so
// if it ever gets abused the worst case is a rate limit or a revoke: generate a fresh one at
// finnhub.io, paste it on the line below, rerun tools/assemble.py, and push. A visitor can still
// paste their own key in the LIVE badge to spend their own quota, and that override wins over this.
window.ALPHALAB_LIVE_KEY = 'd9oe0qpr01qoqrd7g0cgd9oe0qpr01qoqrd7g0d0';
