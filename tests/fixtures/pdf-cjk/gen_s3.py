import json, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(5)
F='/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
PARAS=[
 ['臺灣虛構高等法院民事判決','一一三年度上字第六六六號'],
 ['上　訴　人　壬○○（虛構）'],
 ['被上訴人　癸○○（虛構）'],
 ['上列當事人間請求返還價金事件，上訴人對於中華民國一一三年三月一日臺灣虛構地方法院第一審判決提起上訴，本院判決如下：'],
 ['主　　文'],
 ['上訴駁回。第二審訴訟費用由上訴人負擔。'],
 ['事實及理由'],
 ['一、上訴人主張：兩造於民國一一二年六月一日簽訂買賣契約，上訴人已依約給付價金新臺幣陸拾萬元，被上訴人迄未交付標的物。'],
 ['二、被上訴人則以：上訴人未依約於期限內完成驗收，被上訴人自得拒絕交付等語置辯。'],
 ['三、本院之判斷：'],
 ['（一）兩造間之對話紀錄截圖如下所示，足認被上訴人曾催告上訴人辦理驗收。'],
 ['（二）上訴人未於催告期間內辦理驗收，被上訴人依約拒絕交付，並無違誤。'],
 ['四、綜上所述，原審為上訴人敗訴之判決，核無違誤，上訴論旨指摘原判決不當，求予廢棄改判，為無理由，應駁回其上訴。'],
]
def page(i, dpi=150):
    W,H=int(8.27*dpi),int(11.69*dpi); im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
    fs=int(14/72*dpi); f=ImageFont.truetype(F,fs); x0=int(1.0*dpi); y=int(0.8*dpi)
    sp=int(fs*0.45)  # 寬字距：每個字之後多空 0.45 字寬
    per=24            # 每行字數少，句子被切成很多短行
    lines_truth=[]
    for pi,para in enumerate(PARAS):
        for seg in para:
            for k in range(0,len(seg),per):
                w=seg[k:k+per]; x=x0
                for ch in w: d.text((x,y),ch,font=f,fill=(0,0,0)); x+=fs+sp
                y+=int(fs*1.75)
            lines_truth.append(seg)
        if pi==10:  # 對話紀錄截圖：灰框＋英數＋圖示
            bx,by=x0,y; bw,bh=int(W*0.6),int(1.2*dpi)
            d.rectangle([bx,by,bx+bw,by+bh],fill=(232,236,240),outline=(120,120,120),width=3)
            sf=ImageFont.truetype(F,int(fs*0.7))
            for r in range(5):
                d.rounded_rectangle([bx+20+(r%2)*bw//3,by+15+r*int(bh/5.3),bx+20+(r%2)*bw//3+bw//2,by+15+r*int(bh/5.3)+int(bh/7)],radius=12,fill=(140+r*15,200,140) if r%2 else (255,255,255))
                d.text((bx+30+(r%2)*bw//3,by+18+r*int(bh/5.3)),random.choice(['OK 👍','10:2'+str(r)+' PM','LINE >>','[img] ...','@@ ##']),font=sf,fill=(40,40,40))
            y=by+bh+int(0.25*dpi)
    assert y < H - int(0.4*dpi), (y, H)
    # 紅色印章
    cx,cy,rad=int(W*0.78),int(H*0.5),int(0.55*dpi)
    d.ellipse([cx-rad,cy-rad,cx+rad,cy+rad],outline=(200,30,30),width=6)
    sf=ImageFont.truetype(F,int(rad*0.55)); d.text((cx-rad*0.6,cy-rad*0.35),'虛構',font=sf,fill=(200,30,30))
    im=im.rotate(random.uniform(-0.6,0.6),fillcolor='white',resample=Image.BICUBIC)
    px=im.load()
    for _ in range(W*H//80): px[random.randrange(W),random.randrange(H)]=(random.randint(90,200),)*3
    return im.filter(ImageFilter.GaussianBlur(0.4)), '\n'.join(lines_truth)
ims=[];truth=[]
for i in range(1,4):
    im,t=page(i); ims.append(im); truth.append({'text':t,'image':True})
name='S3_掃描判決_寬字距含圖片_3頁.pdf'
ims[0].save(name,save_all=True,append_images=ims[1:],resolution=150)
json.dump({name:truth},open('truth_s3.json','w'),ensure_ascii=False)
ims[0].resize((620,877)).save('s3_preview.png')
