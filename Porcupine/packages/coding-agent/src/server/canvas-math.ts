/** DOM math labels aligned with canvas coordinates; reused between animation frames. */
export const CANVAS_MATH_SCRIPT = String.raw`
function createCanvasMathLabels(canvas){
  const host=document.createElement('div'),layer=document.createElement('div');host.className='canvas-label-host';layer.className='canvas-math-layer';const parent=canvas.parentNode;parent.insertBefore(host,canvas);canvas.remove();host.append(canvas,layer);const labels=[];let cursor=0;
  return {
    begin(){cursor=0;},
    draw(text,x,y,width,options={}){const formatted=formatLearningMath(String(text));if(!options.plain&&!/\$|\\[([]/.test(formatted))return false;let item=labels[cursor];if(!item){const node=document.createElement('span');node.className='canvas-math-label';layer.append(node);item={node,text:null};labels.push(item)}cursor++;if(item.text!==formatted){renderMathLabel(item.node,formatted);item.text=formatted}const node=item.node;node.dataset.kind=options.kind||'';node.hidden=false;node.style.left=x+'px';node.style.top=y+'px';node.style.width=Math.max(20,width||180)+'px';node.style.textAlign=options.align||'center';node.style.opacity=String(options.opacity??1);node.style.transform=(options.align==='left'?'translateY(-50%)':'translate(-50%,-50%)')+' rotate('+(options.rotation||0)+'deg) scale('+(options.scale||1)+')';return true;},
    end(){for(let i=cursor;i<labels.length;i++)labels[i].node.hidden=true;}
  };
}
`;
