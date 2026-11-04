import { Mark, mergeAttributes, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";

export type RichNode = {type:string; text?:string; attrs?:Record<string,unknown>; marks?:{type:string;attrs?:Record<string,unknown>}[]; content?:RichNode[]};
export const validColor = (value:unknown) =>
  typeof value==="string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
export const validSize = (value:unknown) =>
  typeof value==="string" && /^(?:[8-9]|1[0-9]|2[0-9]|3[0-6])px$/.test(value) ? value : null;

/** Locally defined mark avoids another dependency; Tiptap/Yjs handles character-level edits. */
export const DiagramStyle = Mark.create({
  name:"diagramStyle",
  addAttributes(){
    return {
      color:{
        default:null,
        parseHTML:(element:HTMLElement)=>validColor(element.style.color),
        renderHTML:(attrs:Record<string,unknown>)=>validColor(attrs.color)?{style:"color:"+attrs.color}:{},
      },
      fontSize:{
        default:null,
        parseHTML:(element:HTMLElement)=>validSize(element.style.fontSize),
        renderHTML:(attrs:Record<string,unknown>)=>validSize(attrs.fontSize)?{style:"font-size:"+attrs.fontSize}:{},
      },
    };
  },
  parseHTML(){return [{tag:"span[data-erd-style]"}];},
  renderHTML({HTMLAttributes}) {
    return ["span",mergeAttributes({"data-erd-style":""},HTMLAttributes),0];
  },
});

export const richExtensions = [StarterKit.configure({undoRedo:false}),DiagramStyle];
export const richSchema = getSchema(richExtensions);

export function validateRichDoc(value:unknown):RichNode {
  if(!value || typeof value!=="object") throw new Error("Invalid rich-text document.");
  const input=value as RichNode;
  if(input.type!=="doc" || !Array.isArray(input.content))throw new Error("Rich text must contain a document.");
  let total=0, nodes=0;
  const permittedNodes=new Set(["doc","paragraph","heading","text","hardBreak","bulletList","orderedList","listItem"]);
  const permittedMarks=new Set(["bold","italic","underline","strike","diagramStyle"]);
  function walk(node:RichNode, depth:number){
    if(++nodes>2000 || depth>16 || !permittedNodes.has(node.type))throw new Error("Invalid or oversized rich-text structure.");
    if(node.type==="text"){
      if(typeof node.text!=="string")throw new Error("Rich-text node is missing text.");
      total+=node.text.length;
      if(total>5000)throw new Error("Rich text exceeds the 5,000-character limit.");
    }
    if(node.marks){
      if(!Array.isArray(node.marks)||node.marks.length>12)throw new Error("Invalid text formatting.");
      for(const m of node.marks){
        if(!permittedMarks.has(m.type))throw new Error("Unsupported text formatting.");
        if(m.type==="diagramStyle"){
          const attrs=m.attrs||{};
          if(Object.keys(attrs).some(k=>!["color","fontSize"].includes(k))||
            (attrs.color!=null&&!validColor(attrs.color))||
            (attrs.fontSize!=null&&!validSize(attrs.fontSize)))
            throw new Error("Invalid text color or font size.");
        } else if(m.attrs && Object.keys(m.attrs).length)throw new Error("Unexpected text formatting attributes.");
      }
    }
    if(node.type==="heading" && (![1,2,3].includes(Number(node.attrs?.level))))
      throw new Error("Unsupported heading level.");
    if(node.content){
      if(!Array.isArray(node.content))throw new Error("Invalid rich-text children.");
      node.content.forEach(child=>walk(child,depth+1));
    }
  }
  walk(input,0);
  return richSchema.nodeFromJSON(value).toJSON() as RichNode;
}
export function fragmentFromRichDoc(value:unknown):Y.XmlFragment {
  const json=validateRichDoc(value);
  return prosemirrorJSONToYXmlFragment(richSchema,json);
}
export function jsonFromFragment(fragment:Y.XmlFragment):RichNode {
  return yXmlFragmentToProsemirrorJSON(fragment) as RichNode;
}
export function ensureRichFragment(node:Y.Map<unknown>):Y.XmlFragment {
  const existing=node.get("richBody");
  if(existing instanceof Y.XmlFragment)return existing;
  const fragment=new Y.XmlFragment();
  const legacy=node.get("body");
  const text=legacy instanceof Y.Text ? legacy.toString() : typeof legacy==="string" ? legacy : "";
  if(text){
    const paragraph=new Y.XmlElement("paragraph");
    const xmlText=new Y.XmlText();
    xmlText.insert(0,text);
    paragraph.insert(0,[xmlText]);
    fragment.insert(0,[paragraph]);
  }
  node.set("richBody",fragment);
  return fragment;
}
