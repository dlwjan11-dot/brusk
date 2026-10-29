from PIL import Image, ImageDraw, ImageFilter
# Brusk mark: a lightning bolt whose tail turns into a download arrow (24-unit grid)
MARK = [(14.3,0.8),(4.6,12.6),(10.9,12.6),(9.6,20.2),(19.4,8.4),(13.1,8.4)]
BAR = (5.8,21.9,18.2,23.2)
def icon(size, pad=0.0, radius=0.23, shadow=False):
    S=size*4; img=Image.new('RGBA',(S,S),(0,0,0,0))
    inner=int(S*(1-2*pad)); off=(S-inner)//2
    g=Image.new('RGBA',(inner,inner)); d=ImageDraw.Draw(g)
    top=(20,24,64); bot=(43,92,255)
    for y in range(inner):
        t=y/inner; d.line([(0,y),(inner,y)],fill=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3))+(255,))
    # soft light at top-right
    glow=Image.new('RGBA',(inner,inner),(0,0,0,0)); ImageDraw.Draw(glow).ellipse([inner*0.35,-inner*0.45,inner*1.35,inner*0.55],fill=(120,170,255,70))
    g=Image.alpha_composite(g,glow.filter(ImageFilter.GaussianBlur(inner*0.12)))
    m=Image.new('L',(inner,inner),0); ImageDraw.Draw(m).rounded_rectangle([0,0,inner-1,inner-1],radius=int(inner*radius),fill=255)
    if shadow:
        sh=Image.new('RGBA',(S,S),(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle([off,off+S*0.012,off+inner,off+inner+S*0.012],radius=int(inner*radius),fill=(0,0,0,110))
        img=Image.alpha_composite(img,sh.filter(ImageFilter.GaussianBlur(S*0.012)))
    sq=Image.new('RGBA',(S,S),(0,0,0,0)); sq.paste(g,(off,off),m); img=Image.alpha_composite(img,sq)
    sc=inner/24*0.72; o=off+inner*0.14
    poly=[(x*sc+o,y*sc+o) for x,y in MARK]
    bar=[BAR[0]*sc+o,BAR[1]*sc+o,BAR[2]*sc+o,BAR[3]*sc+o]
    gl=Image.new('RGBA',(S,S),(0,0,0,0)); gd=ImageDraw.Draw(gl); gd.polygon(poly,fill=(255,200,40,160)); gd.rounded_rectangle(bar,radius=(bar[3]-bar[1])/2,fill=(255,200,40,120))
    img=Image.alpha_composite(img,gl.filter(ImageFilter.GaussianBlur(S*0.03)))
    dd=ImageDraw.Draw(img); dd.polygon(poly,fill=(255,198,26,255)); dd.rounded_rectangle(bar,radius=(bar[3]-bar[1])/2,fill=(255,255,255,235))
    return img.resize((size,size),Image.LANCZOS)
def glyph(size, color):
    S=size*8; im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im); k=S/24
    d.polygon([(x*k,y*k) for x,y in MARK],fill=color); d.rounded_rectangle([BAR[0]*k,BAR[1]*k,BAR[2]*k,BAR[3]*k],radius=(BAR[3]-BAR[1])*k/2,fill=color)
    return im.resize((size,size),Image.LANCZOS)
if __name__=='__main__':
    sheet=Image.new('RGBA',(900,300),(246,247,251,255))
    sheet.paste(icon(256),(20,22),icon(256)); sheet.paste(icon(128),(300,86),icon(128)); sheet.paste(icon(48),(450,126),icon(48))
    dark=Image.new('RGBA',(380,300),(15,17,21,255)); sheet.paste(dark,(520,0))
    sheet.paste(icon(200,pad=0.1,shadow=True),(540,50),icon(200,pad=0.1,shadow=True)); sheet.paste(glyph(48,(230,230,230,255)),(780,126),glyph(48,(230,230,230,255)))
    sheet.save('preview.png')
