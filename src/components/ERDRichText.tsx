import { useState, type ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, RemoveFormatting } from "lucide-react";
import * as Y from "yjs";
import { DiagramStyle, richExtensions, type RichNode, validColor, validSize } from "../erd/richSchema";

function mirrorPlainText(node:Y.Map<unknown>, text:string){
  let body=node.get("body");
  if(!(body instanceof Y.Text)){
    body=new Y.Text();
    node.set("body",body);
  }
  const shared=body as Y.Text, before=shared.toString();
  if(before===text)return;
  let start=0,tail=0;
  while(start<before.length&&start<text.length&&before[start]===text[start])start++;
  while(tail<before.length-start&&tail<text.length-start&&before.at(-tail-1)===text.at(-tail-1))tail++;
  shared.doc?.transact(()=>{
    if(before.length-start-tail)shared.delete(start,before.length-start-tail);
    if(text.length-start-tail)shared.insert(start,text.slice(start,text.length-tail));
  });
}
export function RichTextInspector({node}:{node:Y.Map<unknown>}){
  const fragment=node.get("richBody") as Y.XmlFragment;
  const [,refresh]=useState(0);
  const editor=useEditor({
    extensions:[...richExtensions,Collaboration.configure({fragment})],
    editorProps:{attributes:{class:"erd-rich-input","aria-label":"Formatted text box content"}},
    onUpdate:({editor})=>{mirrorPlainText(node,editor.getText({blockSeparator:"\n"}));refresh(v=>v+1);},
    onSelectionUpdate:()=>refresh(v=>v+1),
  },[fragment]);
  if(!editor)return null;
  const button=(label:string,Icon:typeof Bold,active:boolean,action:()=>void)=>
    <button type="button" aria-label={label} title={label} aria-pressed={active} className={active?"active":""}
      onMouseDown={e=>e.preventDefault()} onClick={action}><Icon size={15}/></button>;
  const styles=editor.getAttributes("diagramStyle") as {color?:string;fontSize?:string};
  return <section className="erd-rich-editor">
    <div className="erd-rich-toolbar" aria-label="Text box formatting">
      {button("Bold",Bold,editor.isActive("bold"),()=>editor.chain().focus().toggleBold().run())}
      {button("Italic",Italic,editor.isActive("italic"),()=>editor.chain().focus().toggleItalic().run())}
      {button("Underline",Underline,editor.isActive("underline"),()=>editor.chain().focus().toggleUnderline().run())}
      {button("Strikethrough",Strikethrough,editor.isActive("strike"),()=>editor.chain().focus().toggleStrike().run())}
      {button("Bullet list",List,editor.isActive("bulletList"),()=>editor.chain().focus().toggleBulletList().run())}
      {button("Numbered list",ListOrdered,editor.isActive("orderedList"),()=>editor.chain().focus().toggleOrderedList().run())}
      <label>Size
        <select aria-label="Text font size" value={validSize(styles.fontSize)||""}
          onChange={e=>{
            const current=editor.getAttributes("diagramStyle") as {color?:string;fontSize?:string};
            editor.chain().focus().setMark("diagramStyle",{
              color:validColor(current.color),fontSize:e.target.value||null,
            }).run();
          }}>
          <option value="">Default</option>
          {[10,12,14,16,18,20,24,28,32,36].map(px=><option key={px} value={px+"px"}>{px}px</option>)}
        </select>
      </label>
      <label>Color
        <input type="color" aria-label="Text font color" value={validColor(styles.color)||"#e9e9e3"}
          onChange={e=>{
            const current=editor.getAttributes("diagramStyle") as {color?:string;fontSize?:string};
            editor.chain().focus().setMark("diagramStyle",{
              color:e.target.value,fontSize:validSize(current.fontSize),
            }).run();
          }}/>
      </label>
      {button("Clear formatting",RemoveFormatting,false,()=>editor.chain().focus().unsetAllMarks().run())}
    </div>
    <EditorContent editor={editor}/>
    <p className="erd-hint">Select words to format them. Edits sync live with the team.</p>
  </section>;
}
function renderNode(node:RichNode,key:string):ReactNode {
  if(node.type==="text"){
    let out:ReactNode=node.text||"";
    for(const [i,m] of (node.marks||[]).entries()){
      if(m.type==="bold")out=<strong key={i}>{out}</strong>;
      else if(m.type==="italic")out=<em key={i}>{out}</em>;
      else if(m.type==="underline")out=<u key={i}>{out}</u>;
      else if(m.type==="strike")out=<s key={i}>{out}</s>;
      else if(m.type==="diagramStyle")out=<span key={i} style={{
        color:validColor(m.attrs?.color)||undefined,fontSize:validSize(m.attrs?.fontSize)||undefined,
      }}>{out}</span>;
    }
    return <span key={key}>{out}</span>;
  }
  const children=(node.content||[]).map((part,index)=>renderNode(part,key+"-"+index));
  if(node.type==="paragraph")return <p key={key}>{children}</p>;
  if(node.type==="heading")return <strong key={key} className="erd-rich-heading">{children}</strong>;
  if(node.type==="hardBreak")return <span key={key}>{"\n"}</span>;
  if(node.type==="bulletList")return <ul key={key}>{children}</ul>;
  if(node.type==="orderedList")return <ol key={key}>{children}</ol>;
  if(node.type==="listItem")return <li key={key}>{children}</li>;
  return <span key={key}>{children}</span>;
}
export function RichTextPreview({content}:{content?:RichNode}){
  if(!content)return null;
  return <div className="erd-rich-preview">{(content.content||[]).map((node,index)=>
    renderNode(node,String(index)))}</div>;
}
