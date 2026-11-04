import json, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(11)
BASE=['臺灣虛構地方法院民事判決　一一三年度訴字第七七七號',
 '原告　庚○○（虛構）　住虛構市虛構區測試路三號',
 '被告　辛○○（虛構）　住虛構市虛構區範例街四號',
 '上列當事人間請求損害賠償事件，本院於民國一一三年九月十日言詞辯論終結，判決如下：',
 '主文　被告應給付原告新臺幣壹拾捌萬陸仟元，及自民國一一三年五月一日起至清償日止，按年息百分之五計算之利息。',
 '原告其餘之訴駁回。訴訟費用由被告負擔百分之六十，餘由原告負擔。',
 '事實及理由　一、原告主張：被告於民國一一二年八月二日駕駛自用小客車，因未注意車前狀況而撞擊原告所有之機車，致原告受有左腕挫傷等傷害。',
 '二、被告則以：事故發生時原告亦有超速行駛之情形，應負與有過失之責任等語，資為抗辯。',
 '三、按因故意或過失，不法侵害他人之權利者，負損害賠償責任，民法第一百八十四條第一項前段定有明文。',
 '經查原告提出之診斷證明書、修車估價單及現場照片，足認原告確受有損害，被告所辯尚難採信。',
 '四、本件判決基礎已臻明確，兩造其餘攻擊防禦方法及證據，經本院斟酌後，認均不足以影響本判決之結果，爰不一一論列。']
def lines(i): return [f'第{i}頁　虛構掃描判決測試'] + BASE[(i % 4):] + BASE[:(i % 4)]
def wrap(s,n=30): return [s[k:k+n] for k in range(0,len(s),n)]
def page(i, dpi, noisy):
    W,H=int(8.27*dpi),int(11.69*dpi); im=Image.new('L',(W,H),255); d=ImageDraw.Draw(im)
    fs=int(14/72*dpi); f=ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',fs); y=int(0.9*dpi); x=int(0.9*dpi)
    for l in lines(i):
        for w in wrap(l): d.text((x,y),w,font=f,fill=0); y+=int(fs*1.6)
    if noisy:
        im=im.rotate(random.uniform(-0.8,0.8),fillcolor=255,resample=Image.BICUBIC)
        px=im.load()
        for _ in range(W*H//60): px[random.randrange(W),random.randrange(H)]=random.randint(90,200)
        im=im.filter(ImageFilter.GaussianBlur(0.4))
    return im.convert('RGB')
truth={}
for name,dpi,noisy in [('S1_掃描判決_乾淨_5頁.pdf',200,False),('S2_掃描判決_模擬掃描_5頁.pdf',150,True)]:
    ims=[page(i,dpi,noisy) for i in range(1,6)]
    ims[0].save(name,save_all=True,append_images=ims[1:],resolution=dpi)
    truth[name]=[{'text':'\n'.join(lines(i)),'image':True} for i in range(1,6)]
json.dump(truth,open('truth_scan.json','w'),ensure_ascii=False)
