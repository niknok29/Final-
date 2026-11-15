from sqlmodel import Session, select

from . import routing
from .models import Alert, Crew, District, Road, Shelter, Sos

# id, az, en, ru, lat, lng
DISTRICTS = [
    ("nasimi", "Nəsimi", "Nasimi", "Насими", 40.4093, 49.8671),
    ("yasamal", "Yasamal", "Yasamal", "Ясамал", 40.3930, 49.8230),
    ("narimanov", "Nərimanov", "Narimanov", "Наримановский", 40.4240, 49.8750),
    ("sabail", "Səbail", "Sabail", "Сабаильский", 40.3650, 49.8350),
    ("khatai", "Xətai", "Khatai", "Хатаинский", 40.3900, 49.9050),
    ("binagadi", "Binəqədi", "Binagadi", "Бинагадинский", 40.4500, 49.8200),
    ("nizami", "Nizami", "Nizami", "Низаминский", 40.3880, 49.9450),
    ("khazar", "Xəzər", "Khazar", "Хазарский", 40.4700, 50.0200),
    ("surakhani", "Suraxanı", "Surakhani", "Сураханский", 40.4200, 50.0200),
    ("garadagh", "Qaradağ", "Garadagh", "Гарадагский", 40.2300, 49.6600),
    ("sabunchu", "Sabunçu", "Sabunchu", "Сабунчинский", 40.4400, 49.9500),
    ("pirallahi", "Pirallahı", "Pirallahi", "Пираллахинский", 40.4800, 50.2000),
]

# id, az, en, ru, kind, lat, lng, capacity, occupancy, closed (s9/s12 = reserve shelters, closed until opened)
SHELTERS = [
    ("s1", "Heydər Əliyev Parkı", "Heydar Aliyev Park", "Парк Гейдара Алиева", "park", 40.3950, 49.8520, 2000, 1500, False),
    ("s2", "Bakı Olimpiya Stadionu", "Baku Olympic Stadium", "Бакинский олимпийский стадион", "stadium", 40.4000, 49.9000, 5000, 2000, False),
    ("s3", "Dənizkənarı Milli Park", "Seaside National Park", "Приморский национальный парк", "park", 40.3700, 49.8500, 3000, 1200, False),
    ("s4", "Tofiq Bahramov Stadionu", "Tofiq Bahramov Stadium", "Стадион Тофика Бахрамова", "stadium", 40.3960, 49.8600, 4000, 3700, False),
    ("s5", "Nərimanov Məktəb №132", "Narimanov School No. 132", "Школа №132 Наримановского р-на", "shelter", 40.4250, 49.8700, 600, 150, False),
    ("s6", "Yasamal Mədəniyyət Evi", "Yasamal Culture House", "Дом культуры Ясамала", "shelter", 40.3900, 49.8200, 500, 480, False),
    ("s7", "Xətai İdman Kompleksi", "Khatai Sports Complex", "Спорткомплекс Хатаи", "stadium", 40.3880, 49.9100, 1500, 400, False),
    ("s8", "Binəqədi Parkı", "Binagadi Park", "Парк Бинагади", "park", 40.4450, 49.8250, 1800, 300, False),
    ("s9", "Neftçi Arena (ehtiyat)", "Neftchi Arena (reserve)", "Арена Нефтчи (резерв)", "stadium", 40.3850, 49.9350, 3500, 0, True),
    ("s10", "Nizami Orta Məktəbi", "Nizami High School", "Школа в Низаминском р-не", "shelter", 40.3930, 49.9400, 700, 700, False),
    ("s11", "Sabunçu Parkı", "Sabunchu Park", "Парк Сабунчи", "park", 40.4400, 49.9500, 2500, 600, False),
    ("s12", "Səbail Rəsmi Tədbirlər Zalı (ehtiyat)", "Sabail Event Hall (reserve)", "Зал мероприятий Сабаиля (резерв)", "shelter", 40.3670, 49.8400, 800, 0, True),
]

CREWS = [
    ("c1", "Briqada-1", "available", 40.4000, 49.8500),
    ("c2", "Briqada-2", "available", 40.4200, 49.8700),
    ("c3", "Briqada-3", "available", 40.4050, 49.8800),
    ("c4", "Briqada-4", "available", 40.3800, 49.8300),
    ("c5", "Briqada-5", "available", 40.3900, 49.9200),
    ("c6", "Briqada-6", "busy", 40.4400, 49.9400),
    ("c7", "Briqada-7", "busy", 40.4500, 49.8300),
    ("c8", "Briqada-8", "dispatched", 40.3700, 49.8400),
]

# id, az, en, ru, status, path ([[lat,lng],...])
ROADS = [
    ("r1", "Neftçilər pr.", "Neftchilar Ave.", "пр. Нефтяников", "open", [[40.3680, 49.8350], [40.3800, 49.8450], [40.3950, 49.8520]]),
    ("r2", "Heydər Əliyev pr.", "Heydar Aliyev Ave.", "пр. Гейдара Алиева", "open", [[40.4000, 49.8100], [40.4093, 49.8671], [40.4150, 49.9000]]),
    ("r3", "Tbilisi pr.", "Tbilisi Ave.", "пр. Тбилиси", "open", [[40.4240, 49.8750], [40.4400, 49.8900], [40.4500, 49.9300]]),
    ("r4", "Bülbül pr.", "Bulbul Ave.", "пр. Бюльбюля", "open", [[40.3960, 49.8600], [40.4040, 49.8640], [40.4093, 49.8671]]),
    ("r5", "Azadlıq pr.", "Azadliq Ave.", "пр. Азадлыг", "open", [[40.4093, 49.8671], [40.4250, 49.8800], [40.4400, 49.8950]]),
    ("r6", "Əhməd Rəcəbli küç.", "Ahmad Rajabli St.", "ул. Ахмеда Раджабли", "open", [[40.3870, 49.8300], [40.3930, 49.8230], [40.3990, 49.8200]]),
    ("r7", "Mikayıl Müşfiq küç.", "Mikayil Mushfig St.", "ул. Микаила Мушфига", "open", [[40.3900, 49.8200], [40.4000, 49.8400], [40.4093, 49.8500]]),
    ("r8", "Əhməd Cavad küç.", "Ahmad Javad St.", "ул. Ахмеда Джавада", "open", [[40.3900, 49.9050], [40.3880, 49.9250], [40.3880, 49.9450]]),
    ("r9", "Sumqayıt şossesi", "Sumgayit Highway", "Сумгаитское шоссе", "open", [[40.4400, 49.9500], [40.4300, 49.9700], [40.4200, 50.0200]]),
    ("r10", "Bakıxanov küç.", "Bakikhanov St.", "ул. Бакиханова", "open", [[40.3700, 49.8350], [40.3800, 49.8700], [40.3900, 49.9050]]),
]


# Accessibility flags (everything not listed is accessible; reserve shelters s9/s12 are accessible)
NOT_ACCESSIBLE_SHELTERS = {"s5", "s6", "s7", "s10"}
NOT_ACCESSIBLE_ROADS = {"r4", "r7", "r10"}
ACCESSIBLE_TRANSPORT_CREWS = {"c2", "c4", "c6"}


def seed(s: Session, only_if_empty: bool = False):
    """Insert demo data. With only_if_empty=False, wipes all tables first (used by sim reset)."""
    if only_if_empty and s.exec(select(District)).first():
        return
    for model in (Alert, Sos, Crew, Road, Shelter, District):
        for row in s.exec(select(model)).all():
            s.delete(row)
    s.commit()
    s.add_all(District(id=i, name=a, name_en=e, name_ru=r, lat=la, lng=ln) for i, a, e, r, la, ln in DISTRICTS)
    s.add_all(
        Shelter(id=i, name=a, name_en=e, name_ru=r, kind=k, lat=la, lng=ln, capacity=c, occupancy=o, closed=cl,
                accessible=i not in NOT_ACCESSIBLE_SHELTERS)
        for i, a, e, r, k, la, ln, c, o, cl in SHELTERS
    )
    s.add_all(Crew(id=i, name=n, status=st, lat=la, lng=ln, accessible_transport=i in ACCESSIBLE_TRANSPORT_CREWS)
              for i, n, st, la, ln in CREWS)
    s.add_all(Road(id=i, name=a, name_en=e, name_ru=r, status=st, path=p, accessible=i not in NOT_ACCESSIBLE_ROADS)
              for i, a, e, r, st, p in ROADS)
    s.commit()
    routing.clear_cache()
    routing.build_matrix(s)  # local backup routes for every district x shelter
