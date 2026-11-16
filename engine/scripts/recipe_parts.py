"""Readable explanatory parts in the native 540x960 scene vocabulary.

These are authored schematic parts, not source-frame measurements or physics.
No reconstruction defaults are changed.
"""
import math


def keys(rows, ease="linear", **kw):
    return {"keys":rows,"ease":ease,**kw}


def guided_flow(points, seconds, tint="gold", width=18, start=.05):
    """One field, one contrasting path, and independently phased travellers."""
    lengths=[math.dist(a,b) for a,b in zip(points,points[1:])]
    total=sum(lengths)
    if total<=0 or seconds<=start: raise ValueError("Nonzero path and active interval required")
    at=[start];running=0
    for length in lengths:
        running+=length
        at.append(start+(seconds-start)*running/total)
    layers=[{"kind":"volume","points":points,"width":width,"tint":tint,"highlight":"ivory","intensity":.74,"core":.62,"reveal":keys([[0,0],[seconds,1]])},
            {"kind":"shape","points":points,"closed":False,"stroke":"#f8e9c9","lineWidth":2.1,"alpha":.55,"reveal":keys([[0,0],[seconds,1]])}]
    rotations=[]
    for i,p in enumerate(points):
        a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
        rotations.append(math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))+90)
    for phase in [0,.68]:
        x=keys([[round(t+phase,6),p[0]] for t,p in zip(at,points)])
        y=keys([[round(t+phase,6),p[1]] for t,p in zip(at,points)])
        rot=keys([[round(t+phase,6),r] for t,r in zip(at,rotations)])
        layers.append({"kind":"group","x":x,"y":y,"rotation":rot,
          "alpha":keys([[phase,0],[phase+.13,.95],[seconds+phase-.15,.95],[seconds+phase,0]]),
          "layers":[{"kind":"arrow","length":49,"thickness":10,"fill":"#344b5b","alpha":.45},
                    {"kind":"arrow","length":47,"thickness":8,"fill":"#ffe0a6"}]})
    return layers



def atmospheric_flow(points, seconds=2.8, width=180, tint="gold", particle_tint="#ffe4b4"):
    """Filled transparent air with independently phased interior markers.

    Position this on the actual lifting/descending slope. Amber is a schematic
    illustration convention, not proof that mechanical uplift is solar heating.
    """
    layers=guided_flow(points,seconds,tint=tint,width=width)
    layers[0].update(intensity=.95,core=.17,tail=.38,tip=.65,bands=64)
    layers[1]["alpha"]=.17
    for i in range(13):
        phase=i*.199; xs=[];ys=[]
        for j,(x,y) in enumerate(points):
            t=seconds*j/(len(points)-1);offset=math.sin(i*2.399)*22
            xs.append([t,x+offset]);ys.append([t,y+math.cos(i*1.37)*12])
        layers.append({"kind":"glow","rx":2.8+(i%3)*.55,"ry":3.6+(i%3)*.7,
            "tint":particle_tint,"intensity":.62,
            "x":keys(xs,repeat=seconds,phase=phase),"y":keys(ys,repeat=seconds,phase=phase),
            "alpha":keys([[0,0],[.28,.65],[seconds-.28,.65],[seconds,0]],repeat=seconds,phase=phase)})
    return layers

def condensation_drops():
    """A few phone-readable schematic liquid beads before cloud formation."""
    layers=[]
    for i,(x,y,r) in enumerate([(-102,-26,8.5),(-48,-74,7),(35,-54,9),(104,12,7.7),(-62,65,8.2),(50,72,6.8)]):
        delay=i*.055
        layers.append({"kind":"group","x":keys([[0,x],[2.0,x*.6]]),"y":keys([[0,y],[2.0,y*.6]]),
          "scale":keys([[0,.35],[.6+delay,1],[1.5,1],[2.25,.65]]),
          "alpha":keys([[0,0],[.38+delay,.94],[1.65,.94],[2.3,0]]),
          "layers":[{"kind":"shape","rx":r+1.5,"ry":r+1.5,"fill":"#4f789e","alpha":.50,"x":1,"y":2,"blur":2},
                    {"kind":"shape","rx":r,"ry":r,"fill":{"from":[0,-r],"to":[0,r],"stops":[[0,"#f1f7f4"],[1,"#98b9cf"]]},"stroke":"#d8e5e8","lineWidth":.8}]})
    return layers


def relief_map():
    """Rounded overhead terrain with soft branching relief, not a book slab."""
    footprint='M-187-174 C-141-214-55-198-4-196 C64-211 151-204 191-168 C218-119 201-53 212 3 C224 78 205 143 175 174 C116 204 53 184 0 192 C-75 208-148 191-187 164 C-217 119-199 64-211 8 C-223-61-214-134-187-174Z'
    L=[{"kind":"shape","d":footprint,"fill":{"from":[-200,-200],"to":[200,220],"stops":[[0,"#a6b59a"],[.48,"#6e8b76"],[1,"#435e58"]]},"shadow":{"color":"rgba(22,44,61,.25)","blur":16,"x":1,"y":5}},
       {"kind":"group","clip":{"d":footprint},"layers":[
        {"kind":"shape","d":"M-4-220 C47-149 4-94 21-22 C62 57 10 126 0 220 L250 250 L250-250Z","fill":{"from":[0,-200],"to":[230,200],"stops":[[0,"#d2bd93"],[.5,"#b49a74"],[1,"#817962"]]}},
        *[{"kind":"shape","d":f'M-12 {y-38} Q-72 {y-21} -180 {y-61} Q-92 {y+6} -4 {y+25} L28 {y+11}Z',"fill":"#c0c3a0","alpha":.21,"blur":5} for y in [-120,-20,95]],
        *[{"kind":"shape","d":f'M9 {y-35} Q79 {y-19} 187 {y-54} Q95 {y+24} 11 {y+24} L-9 {y+6}Z',"fill":"#705f50","alpha":.23,"blur":6} for y in [-125,-12,100]],
        {"kind":"shape","d":"M-11-212 Q-48-125-15-39 Q20 35-20 112 L-2 216 L44 154 Q18 59 40-5 Q20-85 36-158Z","fill":{"from":[-30,-210],"to":[55,210],"stops":[[0,"#a3b2a1"],[.5,"#698b83"],[1,"#536a6c"]]},"shadow":{"color":"rgba(30,61,66,.35)","blur":10,"x":5,"y":3}},
        {"kind":"shape","d":"M-5-181 Q-29-98 1-28 Q24 44-6 127 L0 174","closed":False,"stroke":"#d2d6bc","lineWidth":7,"alpha":.38,"blur":3},
        {"kind":"shape","d":"M-5-181 Q-29-98 1-28 Q24 44-6 127 L0 174","closed":False,"stroke":"#d9dec9","lineWidth":1.8,"alpha":.5},
       ]}]
    return L


def gathered_cloud_lobes():
    """An overlapping ellipse silhouette, one shared world-space light gradient.

    Parts have no icon-like flat bases. Their final overlap is one cloud.
    """
    parts=[]
    for i,(x,y,rx,ry) in enumerate([(0,31,137,33),(-68,-20,73,54),(18,-37,78,68),(89,10,64,43),(-101,18,51,36)]):
        parts.append({"kind":"shape","rx":rx,"ry":ry,
            "x":keys([[0,x*1.8],[.7,x*1.7],[2.7,x]],ease="smooth"),
            "y":keys([[0,y*2.2],[.7,y*1.9],[2.7,y]],ease="smooth"),
            "scale":keys([[0,.45],[.8+i*.05,.6],[2.65,1]],ease="smooth"),
            "alpha":keys([[0,0],[.8+i*.04,0],[1.4+i*.04,1]],ease="smooth"),
            "fill":{"from":[0,-y-105],"to":[0,-y+70],"stops":[[0,"#fffcf5"],[.54,"#f5f1f0"],[.82,"#dddbea"],[1,"#bebed4"]]}})
    return parts
