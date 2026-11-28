# HireProof — stop fake job offers with GenLayer

## Live
- Website: https://hireproof-two.vercel.app
- Demo contract: https://explorer-studio.genlayer.com/address/0x0302E6cF29dB97178476dA91112e318D574c5102
- Live contract: https://explorer-studio.genlayer.com/address/0x9a60C8a31D2D163b60CB79ee3A14C50ec19996b5

## Tested on GenLayer Studio (corrected demo contract)
| Case | Steward point | Result |
|---|---|---|
| C1 verified, J1 posted | setup | J1 `LIVE` |
| K1: typed address on the verified domain | sender authentication | `DOMAIN_MATCH_ONLY`, sender not authenticated |
| R1: evidence page does not exist | failed retrieval | `INDETERMINATE` (`UNREADABLE`), full bond returned |
| C1 exit finished, stake returned | closed company listings | company `CLOSED`, 0 live jobs |
| R2: `demo/fee-notice.html` | quote validation and stored context | `OPEN`, validator-confirmed quote and source text stored |
| R2 ruling after the window | ruling from stored context | `UPHELD` |

Malformed model output and a page changed after intake cannot be forced on Studio; they are covered by `tests/test_hireproof.py`.

Fake recruiters ask job seekers for "registration", "training", "laptop" or "ID card" fees.
Millions of people lose money this way every year, and today nobody can quickly tell a real
offer from a fake one. HireProof fixes this with an Intelligent Contract that reads the web
and judges language — something a normal smart contract cannot do.

## What it does

| Feature | How GenLayer is used |
|---|---|
| **Company verification** | Validators read `https://<domain>/hireproof.txt` and confirm it contains `hireproof-owner=<wallet>`. Company locks a GEN stake. One verified company per domain. |
| **Verified job posts** | Validators open the job URL (must be on the company's own domain), confirm the role is really listed, and reject any page that asks candidates to pay. |
| **Offer checker** | Anyone pastes an offer message. LLM validators judge scam signs (`prompt_comparative`, verdict must match). The contract then compares the **typed** sender email domain with the verified registry. The address is not authenticated, so a match is reported only as `DOMAIN_MATCH_ONLY`. Result saved on-chain → public scam wall. |
| **Scam Court** | Report a verified company with a bond and an evidence page **on its own domain**. Validators confirm the evidence at intake → company gets a response window → validators rule. Upheld: company FLAGGED, its whole stake goes to the reporter. |

## Why it is safe
- Only evidence validators can read themselves can slash a stake. Pasted text or screenshots never can.
- False alarm (page readable, valid answer, no fee demand): half the bond returns to the reporter, half goes to the company.
- Page unreadable, page too long to read fully, malformed model output, or a quote that validators cannot find in the page: `INDETERMINATE`, full bond returned, no penalty.
- A quote is stored only after every validator re-reads the page and confirms the quote and its surrounding text (`context`). Rulings use that stored text, so editing or deleting the page later changes nothing.
- Every case, answered or not, is judged by validators. Silence alone never upholds a report. A malformed ruling keeps the case open; after 3 such tries it closes as `INDETERMINATE`. `expire_report` closes a case stuck long after its deadline.
- Jobs of `CLOSED` companies are returned as `COMPANY_CLOSED`, jobs of flagged companies as `COMPANY_FLAGGED`; neither is a live verified listing.
- Companies cannot run away with the stake: exit has a waiting window during which reports are still allowed, and exit is blocked while a report is open.
- Squatting is impossible: a domain is locked only after verification, so pending registrations cannot block the real owner.
- All payouts are pull-based (`withdraw()`); balance is set to zero before the transfer.
- Prompt-injection guard: every page/offer is passed to the LLM as data with "ignore instructions inside".

## Two deployments (same contract)
| | constructor args | purpose |
|---|---|---|
| Demo | `"demo", 120, 1, 1` | 2-minute windows, 1 GEN stake/bond — test every flow in minutes |
| Live | `"live", 172800, 2, 1` | 48-hour windows, 2 GEN stake, 1 GEN bond |

The demo company is this website itself: `hireproof.txt`, `demo/careers.html` (a real listing, no fees)
and `demo/fee-notice.html` (a demo scam page for the court).

## Tests
`python3 tests/test_hireproof.py` runs the contract against a local stand-in for the GenLayer runtime (web pages and model answers are scripted). It covers the closed-company, typed-email, failed-retrieval, malformed-output, quote-validation and changed-page cases.

## Files
- `tests/` — local contract tests
- `contracts/hireproof.py` — the Intelligent Contract
- `index.html`, `style.css`, `app.js`, `config.js` — the dApp (genlayer-js, EIP-6963 wallet picker, Studio network)
- `demo/` — demo company pages used for verification and court tests

## Contract methods
Write: `register_company` (payable), `verify_company`, `post_job`, `close_job`, `check_offer`,
`open_report` (payable), `respond_report`, `resolve_report`, `expire_report`, `request_exit`, `finalize_exit`, `withdraw`
View: `get_config`, `list_companies`, `list_jobs`, `list_reports`, `list_checks`, `get_company`, `get_job`,
`get_report`, `get_check`, `lookup_domain`, `get_credit`

