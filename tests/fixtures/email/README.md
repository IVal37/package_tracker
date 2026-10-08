# Email fixtures

`retailers.json` holds hand-written emails modelled on how each retailer typically words its order and shipping messages: Amazon, Target, Walmart, eBay, Best Buy, Etsy, Apple, Nike, The Home Depot and three Shopify-style stores (two of them both use order `#1001`, on purpose).

**They are synthetic.** They are not copies of real emails, and the tracking numbers are made up (the UPS ones pass the UPS check digit, the rest only match their carrier's format). Each entry has:

- `email`: what arrives (sender, subject, text, optional HTML);
- `model`: the answer Claude is _assumed_ to give, so the pipeline can be tested without calling it;
- `expect`: the shipments and orders that should result.

So these tests check Wayfind's handling of the model's output, not how well Haiku reads each retailer's real email. That is checked separately with `npm run eval:email`, using real examples you put in `real/` (gitignored, never committed).
