# HireProof â€” stop fake job offers with GenLayer

## Live
- Website: https://hireproof-two.vercel.app
- Demo contract: https://explorer-studio.genlayer.com/address/0xa90D2800530a7723455d864Bfa935B5dBa90808E
- Live contract: https://explorer-studio.genlayer.com/address/0x51b42bfb929333FBa3b1009e6Fd8F85dDFaBdd48

## Tested on GenLayer Studio (Demo contract)
- C1 registered and VERIFIED (validators read hireproof.txt)
- J1 job LIVE (validators found it on demo/careers.html, no fee)
- K1 fake offer -> SCAM (fee demand + Gmail impersonating a verified company)
- R1 report: intake confirmed the fee quote, no response in window -> UPHELD, company FLAGGED
- Reporter withdrew 2 GEN (bond + stake)

Fake recruiters ask job seekers for "registration", "training", "laptop" or "ID card" fees.
Millions of people lose money this way every year, and today nobody can quickly tell a real
offer from a fake one. HireProof fixes this with an Intelligent Contract that reads the web
and judges language â€” something a normal smart contract cannot do.

## What it does

| Feature | How GenLayer is used |
|---|---|
| **Company verification** | Validators read `https://<domain>/hireproof.txt` and confirm it contains `hireproof-owner=<wallet>`. Company locks a GEN stake. One verified company per domain. |
| **Verified job posts** | Validators open the job URL (must be on the company's own domain), confirm the role is really listed, and reject any page that asks candidates to pay. |
| **Offer checker** | Anyone pastes an offer message. LLM validators judge scam signs (`prompt_comparative`, verdict must match). The contract then cross-checks the sender email against the verified registry (impersonation / free-mail detection). Result saved on-chain â†’ public scam wall. |
| **Scam Court** | Report a verified company with a bond and an evidence page **on its own domain**. Validators confirm the evidence at intake â†’ company gets a response window â†’ validators rule. Upheld: company FLAGGED, its whole stake goes to the reporter. |

## Why it is safe
- Only evidence validators can read themselves can slash a stake. Pasted text or screenshots never can.
- Failed intake: half the bond returns to the reporter, half goes to the company (anti-spam).
- Confirmed intake but rejected ruling: reporter gets the full bond back (acted in good faith).
- No response by the deadline â†’ upheld. Deleting the page after being reported does not erase the stored quote.
- Companies cannot run away with the stake: exit has a waiting window during which reports are still allowed, and exit is blocked while a report is open.
- Squatting is impossible: a domain is locked only after verification, so pending registrations cannot block the real owner.
- All payouts are pull-based (`withdraw()`); balance is set to zero before the transfer.
- Prompt-injection guard: every page/offer is passed to the LLM as data with "ignore instructions inside".

## Two deployments (same contract)
| | constructor args | purpose |
|---|---|---|
| Demo | `"demo", 120, 1, 1` | 2-minute windows, 1 GEN stake/bond â€” test every flow in minutes |
| Live | `"live", 172800, 2, 1` | 48-hour windows, 2 GEN stake, 1 GEN bond |

The demo company is this website itself: `hireproof.txt`, `demo/careers.html` (a real listing, no fees)
and `demo/fee-notice.html` (a demo scam page for the court).

## Files
- `contracts/hireproof.py` â€” the Intelligent Contract
- `index.html`, `style.css`, `app.js`, `config.js` â€” the dApp (genlayer-js, EIP-6963 wallet picker, Studio network)
- `demo/` â€” demo company pages used for verification and court tests

## Contract methods
Write: `register_company` (payable), `verify_company`, `post_job`, `close_job`, `check_offer`,
`open_report` (payable), `respond_report`, `resolve_report`, `request_exit`, `finalize_exit`, `withdraw`
View: `get_config`, `list_companies`, `list_jobs`, `list_reports`, `list_checks`, `get_company`,
`get_report`, `get_check`, `lookup_domain`, `get_credit`

