// GPU lighting with the reference CPU shadow test, preserving its occlusion rules.
'use strict';
(()=>{
 const vs=`#version 300 es
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
 const fs=`#version 300 es
 precision highp float;
 uniform highp sampler2D art,geom,material,shadowMask;
 uniform vec2 size,outSize;uniform vec3 light;uniform float reach,ambient,cut;
 out vec4 color;
 void main(){ivec2 dst=ivec2(gl_FragCoord.x,outSize.y-gl_FragCoord.y);ivec2 q=min(ivec2(size)-1,ivec2(floor((vec2(dst)+.5)*size/outSize)));
 vec4 a=texelFetch(art,q,0),g=texelFetch(geom,q,0),m=texelFetch(material,q,0);
 if(m.w<=cut){vec3 t=light-vec3(vec2(q)+.5,0.);float d=length(t),att=max(0.,1.-d/reach);float f=.4+2.*att*att*t.z/max(d,1e-8);color=vec4(vec3(34.,34.,40.)*f/255.,1.);return;}
 bool has=m.z>.5;float h=has?g.w:0.;vec3 n=has?g.xyz:vec3(0,0,1);vec3 t=light-vec3(float(q.x)+.5,float(q.y)+.5+h,h);float dist=length(t);vec3 l=t/max(dist,1e-8);float att=pow(max(0.,1.-dist/reach),2.);float shade=max(0.,dot(n,l))*att;if(texelFetch(shadowMask,dst,0).r>.5)shade=0.;
 float rough=has?m.x:1.,metal=has?m.y:0.;vec3 halfv=normalize(l+normalize(vec3(0,1,1)));float shin=max(2.,2./max(.02,pow(rough,4.))-2.);float spec=pow(max(0.,dot(n,halfv)),shin)*((shin+8.)/(8.*3.141592653589793))*.25;
 vec3 f0=vec3(.04)+(a.rgb-vec3(.04))*metal;vec3 c=a.rgb*(1.-metal)*(ambient+2.2*shade)+a.rgb*metal*ambient*.6+f0*spec*2.2*shade;color=vec4(clamp(c,0.,1.),1.);}`;
 class LitGPU {
 constructor(){this.canvas=document.createElement('canvas');const g=this.gl=this.canvas.getContext('webgl2',{preserveDrawingBuffer:true,alpha:false,antialias:false});if(!g)throw Error('WebGL2 unavailable');const shader=(type,src)=>{const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};this.program=g.createProgram();g.attachShader(this.program,shader(g.VERTEX_SHADER,vs));g.attachShader(this.program,shader(g.FRAGMENT_SHADER,fs));g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));this.textures=[];g.disable(g.DITHER);}
 texture(unit,name,w,h,data,float=false){const g=this.gl;g.activeTexture(g.TEXTURE0+unit);const t=this.textures[unit]||(this.textures[unit]=g.createTexture());g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,float?g.RGBA32F:g.RGBA8,w,h,0,g.RGBA,float?g.FLOAT:g.UNSIGNED_BYTE,data);g.uniform1i(g.getUniformLocation(this.program,name),unit);}
 render(o){const r=o.result,g=this.gl;if(g.isContextLost())throw Error('GPU context lost');const scale=TS.clamp(Number(o.renderScale)||1,.25,1),w=Math.ceil(r.w*scale),h=Math.ceil(r.h*scale);if(Math.max(r.w,r.h)>g.getParameter(g.MAX_TEXTURE_SIZE))throw Error('Scene exceeds GPU texture limit');this.canvas.width=w;this.canvas.height=h;g.useProgram(this.program);
 if(this.source!==r){const geom=new Float32Array(r.w*r.h*4),mat=new Float32Array(geom.length);for(let i=0;i<r.w*r.h;i++){const has=!isNaN(r.height[i]);geom.set([has?r.normal[i*3]:0,has?r.normal[i*3+1]:0,has?r.normal[i*3+2]:1,has?r.height[i]:0],i*4);mat.set([has?r.rough[i]:1,has?r.metal[i]:0,has?1:0,r.alpha[i]],i*4);}this.texture(0,'art',r.w,r.h,r.art.data);this.texture(1,'geom',r.w,r.h,geom,true);this.texture(2,'material',r.w,r.h,mat,true);this.source=r;this.hasOccluders=!!r.floor?.spans?.some(sp=>sp && sp.length); }
 const mask=new Uint8Array(w*h*4);o._ptab=o.shadows&&o.usePrisms?TS.Prism.table(o.prisms(),o.light):null;
 if(o.shadows && this.hasOccluders)for(let py=0;py<h;py++)for(let px=0;px<w;px++){const x=Math.min(r.w-1,Math.floor((px+.5)*r.w/w)),y=Math.min(r.h-1,Math.floor((py+.5)*r.h/h)),i=y*r.w+x;if(r.alpha[i]<=o.settings.alphaCut)continue;const has=!isNaN(r.height[i]),z=has?r.height[i]:0,p=[x+.5,y+.5+z,z],t=TS.v3.sub([o.light.x,o.light.y,o.light.z],p);if(TS.v3.len(t)>=o.light.radius)continue;const n=has?[r.normal[i*3],r.normal[i*3+1],r.normal[i*3+2]]:[0,0,1];if(TS.v3.dot(n,t)>0&&o._shadowed(r,p,t))mask[(py*w+px)*4]=255;}
 this.texture(3,'shadowMask',w,h,mask);for(const [name,unit]of [['art',0],['geom',1],['material',2]]){g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,this.textures[unit]);g.uniform1i(g.getUniformLocation(this.program,name),unit);}const loc=n=>g.getUniformLocation(this.program,n);g.uniform2f(loc('size'),r.w,r.h);g.uniform2f(loc('outSize'),w,h);g.uniform3f(loc('light'),o.light.x,o.light.y,o.light.z);g.uniform1f(loc('reach'),o.light.radius);g.uniform1f(loc('ambient'),o.ambient);g.uniform1f(loc('cut'),o.settings.alphaCut);g.viewport(0,0,w,h);g.drawArrays(g.TRIANGLES,0,3);if(g.getError()!==g.NO_ERROR)throw Error('GPU render failed');return this.canvas;}
 }
 TS.LitGPU=LitGPU;
})();
