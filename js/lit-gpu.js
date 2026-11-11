// GPU lighting: every active light (point lights, and area lights as their sample grid) in one pass, with the reference CPU
// shadow test (Output._shadowed) baked into a per-pixel bit mask, one bit per light sample.
// Speed: the per-pixel world points and normals are worked out once per result and render size; each light sample's shadow bits
// are cached by its position and reach, so moving one light re-tests only that light's samples, and colour, intensity and ambient
// edits re-test nothing.
'use strict';
(()=>{
 const MAXS=64; // light samples per render (two 32-bit shadow words per pixel)
 const vs=`#version 300 es
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
 const fs=`#version 300 es
 precision highp float;precision highp int;
 #define MAXS ${MAXS}
 uniform highp sampler2D art,geom,material;uniform highp usampler2D shadowMask;
 uniform vec2 size,outSize;uniform vec3 viewer,wo;uniform mat3 wm;uniform float ambient,cut;
 uniform int count;uniform vec4 lpos[MAXS];uniform vec3 lcol[MAXS]; // lpos: xyz, reach; lcol: colour x intensity x sample weight
 out vec4 color;
 void main(){ivec2 dst=ivec2(gl_FragCoord.x,outSize.y-gl_FragCoord.y);ivec2 q=min(ivec2(size)-1,ivec2(floor((vec2(dst)+.5)*size/outSize)));
 vec4 a=texelFetch(art,q,0),g=texelFetch(geom,q,0),m=texelFetch(material,q,0);
 if(m.w<=cut){vec3 p=wm*vec3(vec2(q)+.5,0.)+wo,s=vec3(0);
  for(int i=0;i<MAXS;i++){if(i>=count)break;vec3 t=lpos[i].xyz-p;float d=length(t),att=max(0.,1.-d/lpos[i].w);s+=att*att*(t.z/max(d,1e-8))*lcol[i];}
  color=vec4((.4+2.*s)*vec3(34.,34.,40.)/255.,1.);return;}
 bool has=m.z>.5;float h=has?g.w:0.;vec3 n=has?g.xyz:vec3(0,0,1);vec3 p=wm*vec3(float(q.x)+.5,float(q.y)+.5,h)+wo;
 float rough=has?m.x:1.,metal=has?m.y:0.;float shin=max(2.,2./max(.02,pow(rough,4.))-2.),norm=(shin+8.)/(8.*3.141592653589793)*.25;
 uvec2 sm=texelFetch(shadowMask,dst,0).rg;vec3 dif=vec3(0),spc=vec3(0);
 for(int i=0;i<MAXS;i++){if(i>=count)break;vec3 t=lpos[i].xyz-p;float d=length(t);if(d>=lpos[i].w)continue;
  vec3 l=t/max(d,1e-8);float k=1.-d/lpos[i].w,shade=max(0.,dot(n,l))*k*k;if(shade<=0.)continue;
  uint bits=i<32?sm.r:sm.g;if(((bits>>uint(i&31))&1u)!=0u)continue;
  vec3 hv=l+viewer;float hl=length(hv),ndh=hl>1e-12?dot(n,hv/hl):0.;
  dif+=shade*lcol[i];spc+=pow(max(0.,ndh),shin)*norm*shade*lcol[i];}
 vec3 f0=vec3(.04)+(a.rgb-vec3(.04))*metal;vec3 c=a.rgb*(1.-metal)*(ambient+2.2*dif)+a.rgb*metal*ambient*.6+f0*spc*2.2;color=vec4(clamp(c,0.,1.),1.);}`;
 class LitGPU {
 constructor(){this.canvas=document.createElement('canvas');const g=this.gl=this.canvas.getContext('webgl2',{preserveDrawingBuffer:true,alpha:false,antialias:false});if(!g)throw Error('WebGL2 unavailable');const shader=(type,src)=>{const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};this.program=g.createProgram();g.attachShader(this.program,shader(g.VERTEX_SHADER,vs));g.attachShader(this.program,shader(g.FRAGMENT_SHADER,fs));g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));this.textures=[];g.disable(g.DITHER);
  this.loc={};for(const n of ['art','geom','material','shadowMask','size','outSize','viewer','wo','wm','ambient','cut','count','lpos','lcol'])this.loc[n]=g.getUniformLocation(this.program,n);
  this.lpos=new Float32Array(MAXS*4);this.lcol=new Float32Array(MAXS*3);this.bits=new Map();}
 texture(unit,name,w,h,data,kind='u8'){const g=this.gl;g.activeTexture(g.TEXTURE0+unit);const t=this.textures[unit]||(this.textures[unit]=g.createTexture());g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
  if(kind==='f32')g.texImage2D(g.TEXTURE_2D,0,g.RGBA32F,w,h,0,g.RGBA,g.FLOAT,data);else if(kind==='u32x2')g.texImage2D(g.TEXTURE_2D,0,g.RG32UI,w,h,0,g.RG_INTEGER,g.UNSIGNED_INT,data);else g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,data);g.uniform1i(this.loc[name],unit);}
 // Per output pixel (once per result, size and alpha cut): the art pixel it shows (-1: empty canvas), its world point and normal.
 _pixels(o,r,w,h,proj){const cut=o.settings.alphaCut,N=o.litNormal,idx=new Int32Array(w*h),P=new Float64Array(w*h*3),Nn=new Float32Array(w*h*3);
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){const k=py*w+px,x=Math.min(r.w-1,Math.floor((px+.5)*r.w/w)),y=Math.min(r.h-1,Math.floor((py+.5)*r.h/h)),i=y*r.w+x;if(r.alpha[i]<=cut){idx[k]=-1;continue;}idx[k]=i;const has=!isNaN(r.height[i]),p=proj.toWorld(x+.5,y+.5,has?r.height[i]:0);P[k*3]=p[0];P[k*3+1]=p[1];P[k*3+2]=p[2];if(has){Nn[k*3]=N[i*3];Nn[k*3+1]=N[i*3+1];Nn[k*3+2]=N[i*3+2];}else Nn[k*3+2]=1;}
  return{idx,P,N:Nn};}
 // One light sample's shadow bits (bit k: output pixel k is lit by it apart from an occluder): the same test as the CPU view.
 _sampleBits(o,r,px,s,z,radius){const{idx,P,N}=px,n=idx.length,bits=new Uint32Array((n+31)>>>5),p=[0,0,0],t=[0,0,0];
  for(let k=0;k<n;k++){if(idx[k]<0)continue;const j=k*3,tx=s.x-P[j],ty=s.y-P[j+1],tz=z-P[j+2];if(tx*tx+ty*ty+tz*tz>=radius*radius)continue;if(N[j]*tx+N[j+1]*ty+N[j+2]*tz<=0)continue;
   p[0]=P[j];p[1]=P[j+1];p[2]=P[j+2];t[0]=tx;t[1]=ty;t[2]=tz;if(o._shadowed(r,p,t,s.tab))bits[k>>>5]|=1<<(k&31);}
  return bits;}
 render(o){const r=o.result,g=this.gl;if(g.isContextLost())throw Error('GPU context lost');const scale=TS.clamp(Number(o.renderScale)||1,.25,1),w=Math.ceil(r.w*scale),h=Math.ceil(r.h*scale);if(Math.max(r.w,r.h)>g.getParameter(g.MAX_TEXTURE_SIZE))throw Error('Scene exceeds GPU texture limit');
  o._prepLights();o._ptab=null;const samples=[];for(const L of o._L)for(const s of L.pts)samples.push({L,s});if(samples.length>MAXS)throw Error(`${samples.length} light samples (GPU max ${MAXS})`);
  this.canvas.width=w;this.canvas.height=h;g.useProgram(this.program);const proj=r.proj||TS.Proj.of(o.settings,r.art),w0=proj.toWorld(0,0,0),lift=(a,b,c)=>{const q=proj.toWorld(a,b,c);return[q[0]-w0[0],q[1]-w0[1],q[2]-w0[2]];},cx=lift(1,0,0),cy=lift(0,1,0),ch=lift(0,0,1);
  if(this.source!==r){const N=o.litNormal,n=r.w*r.h,geom=new Float32Array(n*4),mat=new Float32Array(n*4);for(let i=0;i<n;i++){const j=i*4;if(!isNaN(r.height[i])){geom[j]=N[i*3];geom[j+1]=N[i*3+1];geom[j+2]=N[i*3+2];geom[j+3]=r.height[i];mat[j]=r.rough[i];mat[j+1]=r.metal[i];mat[j+2]=1;}else{geom[j+2]=1;mat[j]=1;}mat[j+3]=r.alpha[i];}this.texture(0,'art',r.w,r.h,r.art.data);this.texture(1,'geom',r.w,r.h,geom,'f32');this.texture(2,'material',r.w,r.h,mat,'f32');this.source=r;this.hasOccluders=!!r.floor?.spanData?.length;}
  // Shadow bits: cached per sample; the cache (and the per-pixel points) start over for a new result, render size, alpha cut or normals.
  const key=[w,h,o.settings.alphaCut].join();if(this.bitSrc!==r||this.bitN!==o.litNormal||this.bitKey!==key){this.bitSrc=r;this.bitN=o.litNormal;this.bitKey=key;this.bits.clear();this.px=null;}
  const mask=new Uint32Array(w*h*2),keep=new Map();
  samples.forEach(({L,s},si)=>{if(!L.sh||!this.hasOccluders)return;const sk=[s.x,s.y,L.z,L.radius].join();let bits=this.bits.get(sk);if(!bits){this.px=this.px||this._pixels(o,r,w,h,proj);bits=this._sampleBits(o,r,this.px,s,L.z,L.radius);}keep.set(sk,bits);
   const hi=si>>>5,bit=1<<(si&31);for(let wi=0;wi<bits.length;wi++){let word=bits[wi];while(word){const b=31-Math.clz32(word&-word);word&=word-1;mask[((wi<<5)+b)*2+hi]|=bit;}}});
  this.bits=keep; // only the samples in this render stay cached
  this.texture(3,'shadowMask',w,h,mask,'u32x2');for(const [name,unit]of [['art',0],['geom',1],['material',2]]){g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,this.textures[unit]);g.uniform1i(this.loc[name],unit);}
  samples.forEach(({L,s},i)=>{this.lpos.set([s.x,s.y,L.z,L.radius],i*4);this.lcol.set([L.col[0]*L.w,L.col[1]*L.w,L.col[2]*L.w],i*3);});
  const l=this.loc;g.uniform1i(l.count,samples.length);g.uniform4fv(l.lpos,this.lpos);g.uniform3fv(l.lcol,this.lcol);g.uniform2f(l.size,r.w,r.h);g.uniform2f(l.outSize,w,h);g.uniform3f(l.viewer,...proj.viewer);g.uniform3f(l.wo,...w0);g.uniformMatrix3fv(l.wm,false,[...cx,...cy,...ch]);g.uniform1f(l.ambient,o.ambient);g.uniform1f(l.cut,o.settings.alphaCut);
  g.viewport(0,0,w,h);g.drawArrays(g.TRIANGLES,0,3);if(g.getError()!==g.NO_ERROR)throw Error('GPU render failed');this.lights=samples.length;return this.canvas;}
 }
 TS.LitGPU=LitGPU;
})();
