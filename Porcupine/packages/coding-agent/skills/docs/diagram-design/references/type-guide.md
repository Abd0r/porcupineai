# Type Guide — which diagram, and a worked example for each

The type answers the *question*. Worked Mermaid examples below; adapt labels to
your domain and apply the style-guide tokens.

## Architecture / component (`flowchart`)

Question: "What are the parts and how do they connect?"

```mermaid
flowchart LR
    Client[Client] -->|HTTPS| Gateway[API Gateway]
    Gateway --> Auth[Auth Service]
    Gateway --> Worker[Job Worker]
    Auth --> DB[(Postgres)]
    Worker --> DB
    Worker --> Queue[Queue]
```

Notes: put external services in `danger`/`warn` tone, internal in `accent`.
Label every edge with the protocol/action.

## Sequence (`sequenceDiagram`)

Question: "What happens, in order, between actors?"

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant D as DB
    C->>A: POST /order
    A->>D: INSERT order
    D-->>A: row
    alt success
        A-->>C: 201
    else failure
        A-->>C: 500
    end
```

Notes: use `alt/else` for branches, `Note over X` for caveats. Keep the happy
path first, branches second.

## State machine (`stateDiagram-v2`)

Question: "What states exist and what moves between them?"

```mermaid
stateDiagram-v2
    [*] --> Pending
    Pending --> Running: start
    Running --> Succeeded: done
    Running --> Failed: error
    Failed --> Pending: retry
    Succeeded --> [*]
    Failed --> [*]
```

Notes: every state needs an entry and an exit; terminal states point to `[*]`.

## ER / data model (`erDiagram`)

Question: "How do entities relate?"

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "is in"
    USER {
        uuid id PK
        string email UK
    }
    ORDER {
        uuid id PK
        uuid user_id FK
        string status
    }
```

Notes: mark PK/FK/UK. Crow's-foot: `||` one, `o{` zero-or-many, `|{` one-or-many.

## Flowchart / process (`flowchart`)

Question: "What are the steps and decisions?"

```mermaid
flowchart TD
    A[Receive request] --> B{Valid?}
    B -->|no| C[Reject]
    B -->|yes| D[Process]
    D --> E[Respond]
```

Notes: decisions are diamonds `{}`, actions are rectangles. One entry, clear
terminal.

## Swimlane (`flowchart` + subgraphs)

Question: "Who does what, in parallel lanes?"

```mermaid
flowchart TD
    subgraph Client
        A[Send request]
    end
    subgraph Server
        B[Handle]
        C[Respond]
    end
    subgraph DB
        D[Query]
    end
    A --> B --> D --> C --> A
```

## Org chart / hierarchy (`flowchart` tree)

Question: "Who reports to whom?"

```mermaid
flowchart TD
    CEO --> Eng[Engineering]
    CEO --> Ops[Operations]
    Eng --> FE[Frontend]
    Eng --> BE[Backend]
```

## Gantt / timeline (`gantt`)

Question: "What is the schedule?"

```mermaid
gantt
    title Release plan
    dateFormat YYYY-MM-DD
    section Build
    Feature A :a1, 2026-08-01, 5d
    Feature B :a2, after a1, 3d
    section Ship
    Release :after a2, 2d
```

## Bar / line / pie (`pie` or SVG)

Question: "How do quantities compare?" — `pie` for part-of-whole, SVG for
bar/line (Mermaid's chart types are limited; hand-write SVG for anything
axis-based).

```mermaid
pie title Time by phase
    "Planning" : 20
    "Implementation" : 55
    "Verification" : 25
```

## Quadrant (2x2) — SVG only

Mermaid can't express a 2x2 positioning chart. Hand-write SVG: a square divided
into 4, axes labeled (effort vs impact, etc.), items placed by their
coordinates, color-coded by quadrant.
