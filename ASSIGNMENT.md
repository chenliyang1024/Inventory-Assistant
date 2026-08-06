# Take-home: Construction material inventory assistant

## Overview

Build a conversational assistant that lets a construction material supplier check stock, look up supplier terms, and place orders against live inventory.

You will be given a JSON file of synthetic supplier data. Your job is to ingest it into a database, expose a backend API over it, and put a simple chat interface in front of that API. The assistant answers questions in natural language and returns accurate figures pulled from the data.

**Time expectation:** roughly 5 hours. If you find yourself going well beyond that, stop and write down what you would have done next — we would rather see a smaller system that works than a large one that doesn't.

**Deadline:** end of day Wednesday.

**AI tools:** use them. Copilot, Cursor, Claude Code, ChatGPT, agents, whatever you normally work with. We are evaluating the system you ship and the decisions behind it, not whether you typed every line.

---

## The data

You'll receive `inventory_data.json` with three top-level keys:

- `meta` — as-of date, currency, and a `definitions` block. Read this first.
- `suppliers` — 9 suppliers with `standard_lead_time_days` and `payment_terms`.
- `materials` — 77 SKUs across structural steel, rebar, fasteners, concrete, timber, insulation, sheet metal, welding consumables, and site supplies.

Each material has:

| Field | Meaning |
|---|---|
| `sku` | Unique identifier |
| `description` | Human-readable name, e.g. `2x6x10 ft SPF dimensional lumber` |
| `category` | e.g. `rebar`, `structural_steel` |
| `spec_grade` | Standard or grade, may be `null` |
| `unit_of_measure` | `each`, `sheet`, `bag`, `m3`, `roll`, etc. |
| `unit_price` | Price per unit, CAD |
| `qty_on_hand` | Physical units in the warehouse |
| `qty_reserved` | Units already committed but not yet shipped |
| `reorder_point` | Availability at or below this should flag a reorder |
| `min_order_qty` | Supplier's minimum for **replenishment**, not for customer orders |
| `primary_supplier_id` | Links to `suppliers` |
| `warehouse` | `WH-A`, `WH-B`, or `YARD-1` |
| `discontinued` | Boolean |

The data is synthetic and stands in for a real ERP feed. Treat it as the source of truth.

---

## Business rules

These are the rules your system must follow. They are the main thing we check.

**1. Availability is derived, not stored.**

```
qty_available = qty_on_hand - qty_reserved
```

Never report `qty_on_hand` as availability. Some SKUs are fully reserved, and at least one is over-allocated (more reserved than on hand) — decide how to present that and say why in your README.

**2. Placing an order increases `qty_reserved`.** It does not reduce `qty_on_hand`. Stock only leaves the warehouse on shipment, which is out of scope here.

**3. Reject an order if the requested quantity exceeds `qty_available`.** Say so plainly, state what *is* available, and do not partially fulfil silently.

**4. Reject orders for discontinued items,** even when stock remains.

**5. Never invent a SKU.** If the catalogue has no match, say so. Do not return the nearest-sounding item as though it were the thing that was asked for.

**6. `min_order_qty` applies to restocking from the supplier, not to customer orders.** A customer may order 1 unit of something with a min order quantity of 25.

**7. Line total is `unit_price × quantity`.** No tax or volume discount unless you choose to add one and document it.

---

## What to build

1. **Ingestion** — parse the JSON into a database of your choice (Postgres, SQLite, MySQL, anything). Ingestion should be repeatable, not a one-off manual load.
2. **Backend API** — endpoints covering stock lookup, search, order placement, and supplier information. Design the surface as you see fit.
3. **Chat frontend** — a simple interface where a user types a question and gets an answer. Plain and functional is fine; this is not a design exercise.
4. **Deployment** — a working public URL we can open and use.

The assistant may use an LLM to interpret the question and phrase the reply, but **every number it reports must come from your database**, not from the model. Answers must be reproducible.

---

## Queries it must handle

Your assistant must answer these five correctly. Each one contains something awkward — that is deliberate.

1. **Do we have any W12x40 beams available, and which warehouse are they in?**
2. **How many 25M epoxy rebars do we have in stock?**
3. **I want to order 500 lengths of 15M rebar. Can you fulfil that, and what would it cost?**
4. **Can I order 3 sheets of 3/8 inch steel plate?**
5. **What are the payment terms and standard lead time for our rebar supplier, and how many 20M epoxy rebars can we ship today?**

We will ask further questions of our own in the same spirit, so build for the general shape of the problem rather than special-casing these five.

---

## Design write-up

Alongside the code, submit a **flowchart of your system** and a short description of how you arrived at it.

The diagram should show how a user's question travels through your system and back — the components involved, where the data lives, what talks to what, and where the decisions get made. Draw it however you like: Mermaid in your README, Excalidraw, draw.io, Figma, or a clear photo of a whiteboard. We are not grading the artwork.

Add a few paragraphs covering:

- The shape you chose and what you considered instead
- Where you put the boundary between the language model and your own code, and why
- Which parts you would expect to break first under real load or messier data

This carries real weight in our review. A clear diagram of a modest system beats a sprawling one nobody can follow.

---

## Deployment notes

Free tiers that work well here: **Render**, **Railway**, or **Fly.io** for a persistent container.

If you deploy to **Vercel**, note that its serverless filesystem is ephemeral — a SQLite file written at runtime will not survive between invocations. Pair it with a hosted Postgres free tier (Neon, Supabase) or use a platform that gives you a persistent disk. Loading the dataset into memory at startup is an acceptable fallback as long as you say so in your README and orders persist for the life of the session.

---

## Deliverables

- A link to a **public Git repository**
- A **live URL** we can use
- A **system flowchart** plus your design write-up (in the repo README, or as a linked/attached file)
- A **README** in the repo covering:
  - How to run it locally
  - Your database schema and why you shaped it that way
  - Which business rules you implemented and any you skipped
  - Assumptions you made where the spec was silent
  - What you would do with another week

Tests are welcome and count in your favour, particularly around the availability calculation and order rejection paths.

---

## How we evaluate

- **Correctness** — do the numbers match the data, including the awkward cases
- **Rule handling** — over-allocated stock, fully reserved items, discontinued SKUs, unknown SKUs
- **Code quality** — structure, naming, error handling, tests
- **Judgment** — what you chose to build, what you chose to leave out, and whether you explained it
- **The flowchart and write-up** — whether you can explain your own system clearly

An honest, working, well-documented system beats an ambitious half-finished one. If you run out of time, ship what works and tell us what's missing.

---

## Questions

If something in the spec is ambiguous, make a reasonable call, note it in your README, and keep going. Reach out if you're genuinely blocked.
