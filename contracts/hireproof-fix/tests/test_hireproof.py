"""Local tests: the contract runs against a scripted stand-in for the GenLayer runtime."""
import json, os, sys, types, datetime

class TreeMap(dict):
    def __class_getitem__(cls, k): return cls

class _Any:
    def __call__(self, f): return f
    def __getattr__(self, n): return self

web, answers = {}, []
gl = types.SimpleNamespace()
class Contract:
    def __new__(cls, *a):
        o = super().__new__(cls)
        for n in ("companies", "domain_index", "jobs", "reports", "checks", "credits"):
            setattr(o, n, TreeMap())
        return o
def render(url, mode="text"):
    v = web[url]
    if isinstance(v, list): v = v.pop(0) if len(v) > 1 else v[0]
    if isinstance(v, Exception): raise v
    return v
def prompt(p):
    prompts.append(p)
    v = answers.pop(0)
    if isinstance(v, Exception): raise v
    return v if isinstance(v, str) else json.dumps(v)
prompts = []
gl.Contract = Contract
gl.public = types.SimpleNamespace(view=lambda f: f, write=_Any())
gl.public.write.__dict__["payable"] = lambda f: f
gl.nondet = types.SimpleNamespace(web=types.SimpleNamespace(render=render), exec_prompt=prompt)
gl.eq_principle = types.SimpleNamespace(strict_eq=lambda f: f(), prompt_comparative=lambda f, principle: f())
fake = types.ModuleType("genlayer")
fake.gl, fake.TreeMap, fake.u256, fake.Address = gl, TreeMap, int, str
sys.modules["genlayer"] = fake
src = open(os.path.join(os.path.dirname(__file__), "..", "contracts", "hireproof.py"), encoding="utf-8").read()
M = {}
exec(compile(src, "hireproof.py", "exec"), M)

G = 10 ** 18
OWNER, REP = "0x" + "a" * 40, "0x" + "b" * 40
T = [1_800_000_000]
def act(who, value=0):
    gl.message = types.SimpleNamespace(sender_address=types.SimpleNamespace(as_hex=who), value=value)
    gl.message_raw = {"datetime": datetime.datetime.fromtimestamp(T[0], datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

FEE = "All selected candidates must pay a refundable training fee of Rs 2500 to join."
PAGE = "Joining notice for selected candidates.\n" + FEE + "\nSend the screenshot to HR."
URL = "https://acme.com/notice"
JOBS = "https://acme.com/careers"

def setup():
    web.clear(); answers.clear(); prompts.clear()
    act(OWNER); c = M["HireProof"]("demo", 120, 1, 1)
    act(OWNER, G); c.register_company("Acme", "acme.com")
    web["https://acme.com/hireproof.txt"] = "hireproof-owner=" + OWNER
    act(OWNER); c.verify_company("C1")
    web[URL] = PAGE
    web[JOBS] = "Open positions: Junior Web Developer. We never charge candidates."
    return c
J = lambda s: json.loads(s)
def report(c):
    act(REP, G); c.open_report("C1", URL, "asks fee")
    return J(c.get_report("R%d" % c.n_reports))
def post(c, ans={"listed": True, "asks_fee": False}):
    answers.append(ans); act(OWNER); c.post_job("C1", "Junior Web Developer", "", "", JOBS)
    return J(c.get_job("J%d" % c.n_jobs))
def credit(c, a): return int(c.get_credit(a))
DEMAND = {"asks_pay": True, "quote": FEE}

def test_closed_company_jobs_not_live():
    c = setup(); assert post(c)["status"] == "LIVE"
    act(OWNER); c.request_exit("C1")
    T[0] += 121; act(OWNER); c.finalize_exit("C1")
    assert J(c.get_job("J1"))["status"] == "COMPANY_CLOSED"
    assert J(c.list_jobs(10))[0]["status"] == "COMPANY_CLOSED"
    assert credit(c, OWNER) == G and c.lookup_domain("acme.com") == ""
    try: act(OWNER); c.close_job("J1"); raise AssertionError("closed job could be closed")
    except Exception as e: assert "not live" in str(e)
    # same domain registered again does not revive old listings
    act(OWNER, G); c.register_company("Acme", "acme.com"); act(OWNER); c.verify_company("C2")
    assert J(c.get_job("J1"))["status"] == "COMPANY_CLOSED"

def test_typed_email_is_domain_match_only():
    c = setup()
    safe = {"verdict": "SAFE", "asks_payment": False, "red_flags": [], "summary": "ok"}
    for email, want, match in (("hr@acme.com", "DOMAIN_MATCH_ONLY", "MATCH"), ("x@gmail.com", "SUSPICIOUS", "MISMATCH"), ("", "NO_RED_FLAGS", "NOT_CHECKED")):
        answers.append(safe); act(REP); c.check_offer("We invite you to an interview on Monday.", email, "acme.com")
        k = J(c.get_check("K%d" % c.n_checks))
        assert (k["verdict"], k["domain_match"], k["sender_authenticated"]) == (want, match, False), k

def test_bad_offer_output_is_indeterminate():
    for bad in ("garbage", {}, {"verdict": "MAYBE"}, RuntimeError("llm down")):
        c = setup(); answers.append(bad); act(REP); c.check_offer("We invite you to an interview on Monday.", "hr@acme.com", "acme.com")
        assert J(c.get_check("K1"))["verdict"] == "INDETERMINATE"

def test_job_check_failures_are_retryable():
    c = setup(); assert post(c, "garbage")["status"] == "NOT_CHECKED"
    web[JOBS] = RuntimeError("down"); act(OWNER); c.post_job("C1", "Junior Web Developer", "", "", JOBS)
    assert J(c.get_job("J2"))["status"] == "NOT_CHECKED"

def no_penalty(c, r, why):
    assert r["status"] == "INDETERMINATE" and r["intake"] == why, r
    assert credit(c, REP) == G and credit(c, OWNER) == 0, (why, credit(c, REP))
    co = J(c.get_company("C1"))
    assert co["status"] == "VERIFIED" and co["open_report"] == "" and int(co["stake"]) == G

def test_failed_retrieval_no_penalty():
    for page in (RuntimeError("timeout"), "", "404: NOT_FOUND Code: NOT_FOUND ID: bom1::abc"):
        c = setup(); web[URL] = page; no_penalty(c, report(c), "UNREADABLE")

def test_malformed_intake_no_penalty():
    for bad in ("not json", {}, {"asks_pay": "maybe"}, {"asks_pay": True, "quote": 5}, RuntimeError("llm")):
        c = setup(); answers.append(bad); no_penalty(c, report(c), "MALFORMED")

def test_truncated_page_no_penalty():
    c = setup(); web[URL] = "word " * 4000; answers.append({"asks_pay": False, "quote": ""})
    no_penalty(c, report(c), "TOO_LONG")

def test_invented_quote_rejected():
    for q in ("Candidates must send one lakh rupees today.", "", "pay"):
        c = setup(); answers.append({"asks_pay": True, "quote": q}); no_penalty(c, report(c), "QUOTE_NOT_FOUND")

def test_quote_not_confirmed_by_second_read():
    c = setup(); web[URL] = [PAGE, "This page now shows something entirely different."]; answers.append(DEMAND)
    no_penalty(c, report(c), "QUOTE_NOT_CONFIRMED")

def test_real_false_alarm_still_split():
    c = setup(); answers.append({"asks_pay": False, "quote": ""}); r = report(c)
    assert r["status"] == "DISMISSED" and credit(c, REP) == G // 2 and credit(c, OWNER) == G // 2

def test_ruling_uses_stored_context_after_page_deleted():
    c = setup(); post(c); answers.append(DEMAND); r = report(c)
    assert r["status"] == "OPEN" and r["quote"] in r["context"]
    web[URL] = RuntimeError("deleted")
    T[0] += 121; answers.append({"decision": "UPHOLD", "reason": "fee demanded"}); act(REP); c.resolve_report("R1")
    assert r["context"] in prompts[-1]
    assert J(c.get_report("R1"))["status"] == "UPHELD" and credit(c, REP) == 2 * G
    assert J(c.get_job("J1"))["status"] == "COMPANY_FLAGGED"

def test_silence_alone_does_not_uphold():
    c = setup(); answers.append(DEMAND); report(c); T[0] += 121
    answers.append({"decision": "REJECT", "reason": "about customers"}); act(REP); c.resolve_report("R1")
    assert J(c.get_report("R1"))["status"] == "REJECTED" and credit(c, REP) == G

def test_malformed_ruling_retries_then_indeterminate():
    for responded in (False, True):
        c = setup(); answers.append(DEMAND); report(c)
        if responded: act(OWNER); c.respond_report("R1", "That was about our customers.")
        else: T[0] += 121
        for i, bad in enumerate(("junk", {"decision": True}, RuntimeError("llm"))):
            answers.append(bad); act(REP); c.resolve_report("R1")
            r = J(c.get_report("R1"))
            assert r["status"] == ("OPEN" if i < 2 else "INDETERMINATE")
        assert credit(c, REP) == G and int(J(c.get_company("C1"))["stake"]) == G

def test_retry_can_still_succeed():
    c = setup(); answers.append(DEMAND); report(c); T[0] += 121
    answers.extend(["junk", {"decision": "UPHOLD", "reason": "yes"}])
    act(REP); c.resolve_report("R1"); act(REP); c.resolve_report("R1")
    assert J(c.get_report("R1"))["status"] == "UPHELD"

def test_expiry():
    c = setup(); answers.append(DEMAND); report(c)
    try: act(OWNER); c.expire_report("R1"); raise AssertionError("expired early")
    except Exception as e: assert "cannot expire" in str(e)
    T[0] += 120 * 8 + 1; act(OWNER); c.expire_report("R1")
    assert J(c.get_report("R1"))["status"] == "INDETERMINATE" and credit(c, REP) == G

def test_indeterminate_during_exit_extends_once():
    c = setup(); act(OWNER); c.request_exit("C1"); T[0] += 100
    web[URL] = ""; report(c); first = J(c.get_company("C1"))["exit_at"]
    assert first == T[0] + 120
    T[0] += 50; report(c); assert J(c.get_company("C1"))["exit_at"] == first

def test_wallet_containing_404_can_verify():
    c = setup(); who = "0x" + "404" + "c" * 37
    act(who, G); c.register_company("Beta", "beta.com")
    web["https://beta.com/hireproof.txt"] = "hireproof-owner=" + who
    act(who); c.verify_company("C2")
    assert J(c.get_company("C2"))["status"] == "VERIFIED"

if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    for t in tests:
        t(); print("PASS", t.__name__)
    print(len(tests), "tests passed")
