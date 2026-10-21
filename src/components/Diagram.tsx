import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import mermaid from "mermaid";
import { Download, GitBranch } from "lucide-react";
import { download } from "../api";
const examples: Record<string, string> = {
  Flowchart:
    "flowchart TD\n  A[An idea] --> B{Worth exploring?}\n  B -->|Yes| C[Try something small]\n  B -->|Not yet| D[Keep thinking]\n  C --> E[Share what you learn]\n  D --> A",
  Sequence:
    "sequenceDiagram\n  participant A as Alex\n  participant B as Team\n  A->>B: Share an idea\n  B->>A: Ask questions\n  A->>B: Build a first draft",
  Mindmap:
    "mindmap\n  root((The next idea))\n    Why\n      The problem\n      The opportunity\n    How\n      First steps\n      People\n    What next",
};
export default function Diagram({
  doc,
  title,
  theme,
}: {
  doc: Y.Doc;
  title: string;
  theme: string;
}) {
  const text = doc.getText("diagram"),
    [source, setSource] = useState(text.toString()),
    [svg, setSvg] = useState(""),
    [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    const update = () => setSource(text.toString());
    text.observe(update);
    return () => text.unobserve(update);
  }, [text]);
  useEffect(() => {
    const current = ++sequence.current;
    const timer = setTimeout(async () => {
      if (!source.trim()) {
        setSvg("");
        setError("");
        return;
      }
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          maxTextSize: 20000,
          suppressErrorRendering: true,
        });
        const result = await mermaid.render(
          `diagram-${current}-${Date.now()}`,
          source,
        );
        if (current === sequence.current) {
          setSvg(result.svg);
          setError("");
        }
      } catch {
        if (current === sequence.current)
          setError(
            "This diagram has a syntax error. Check the source and try again.",
          );
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [source, theme]);
  function update(value: string) {
    const previous = text.toString();
    let start = 0;
    while (
      start < previous.length &&
      start < value.length &&
      previous[start] === value[start]
    )
      start++;
    let end = 0;
    while (
      end < previous.length - start &&
      end < value.length - start &&
      previous[previous.length - 1 - end] === value[value.length - 1 - end]
    )
      end++;
    doc.transact(() => {
      text.delete(start, previous.length - start - end);
      text.insert(start, value.slice(start, value.length - end));
    });
  }
  return (
    <div className="diagram-editor">
      <div className="diagram-tools">
        <span>
          <GitBranch size={17} /> Mermaid diagram
        </span>
        <select
          aria-label="Diagram examples"
          defaultValue=""
          onChange={(e) => {
            if (
              e.target.value &&
              (!source || confirm("Replace the current diagram?"))
            )
              update(examples[e.target.value]);
            e.target.value = "";
          }}
        >
          <option value="">Insert example</option>
          {Object.keys(examples).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          disabled={!svg || !!error}
          onClick={() => download(`${title}.svg`, svg, "image/svg+xml")}
        >
          <Download size={16} /> Export SVG
        </button>
      </div>
      <div className="diagram-split">
        <label className="diagram-source">
          <span>SOURCE</span>
          <textarea
            spellCheck={false}
            aria-label="Diagram source"
            maxLength={20000}
            value={source}
            onChange={(e) => update(e.target.value)}
            placeholder="Choose an example above, or write a Mermaid diagram."
          />
        </label>
        <div className="diagram-output">
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="empty">
              <GitBranch size={36} />
              <h3>Connect the dots.</h3>
              <p>
                Flowcharts, sequences, and mind maps.
                <br />
                Choose an example to get started.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
