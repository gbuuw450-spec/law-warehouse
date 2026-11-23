-- 법률창고: 조세심판원 결정례 찾기용 표
-- 법제처 API는 결정례를 사건명으로만 찾아 주므로, 사건명과 재결요지를 받아 두고 여기서 직접 낱말을 찾는다.
-- 본문(이유)은 보관하지 않는다. 화면에 보여 줄 본문은 그때그때 법제처에서 가져온다.
-- 사용자가 입력한 사실관계나 검색 결과는 여기에 저장하지 않는다.

create extension if not exists pg_trgm;

create table if not exists public.tax_decisions (
  id bigint primary key,                 -- 법제처 일련번호 (본문 조회에 사용)
  case_no text not null,                 -- 청구번호 (예: 조심 2019중1999)
  decided text not null default '',      -- 의결일자 YYYYMMDD
  tax text not null default '',          -- 세목
  title text not null default '',        -- 사건명
  gist text not null default '',         -- 재결요지
  order_text text not null default '',   -- 주문 앞부분
  outcome text not null default 'unknown', -- 주문에서 읽은 결과: accepted(인용), rejected(기각), unknown
  search_text text generated always as (title || ' ' || gist) stored
);

-- 서버용 키로만 읽고 쓸 수 있게 잠근다. (공개 키로는 아무것도 볼 수 없다)
alter table public.tax_decisions enable row level security;

create index if not exists tax_decisions_search_idx on public.tax_decisions using gin (search_text gin_trgm_ops);
create index if not exists tax_decisions_decided_idx on public.tax_decisions (decided desc);

-- 검색어 중 하나라도 사건명이나 재결요지에 들어 있는 결정례를 찾는다.
-- 맞는 검색어가 많을수록(앞쪽 검색어 3개는 2점) 위에 두고, 점수가 같으면 최근 것을 위에 둔다.
create or replace function public.search_tax_decisions(keywords text[], wanted text default null, max_rows int default 150)
returns table (id bigint, case_no text, decided text, title text, gist text, outcome text, score int)
language sql stable
set search_path = public, extensions
as $$
  with pats as (
    select '%' || replace(k, ' ', '%') || '%' as pat, case when ord <= 3 then 2 else 1 end as weight
    from unnest(keywords) with ordinality as t(k, ord)
    where length(trim(k)) >= 2
  )
  select d.id, d.case_no, d.decided, d.title, d.gist, d.outcome,
         (select coalesce(sum(p.weight), 0) from pats p where d.search_text ilike p.pat)::int as score
  from public.tax_decisions d
  where d.search_text ilike any (array(select pat from pats))
    and (wanted is null or d.outcome = wanted)
  order by score desc, d.decided desc
  limit least(greatest(max_rows, 1), 300);
$$;

revoke all on function public.search_tax_decisions(text[], text, int) from public, anon, authenticated;
grant execute on function public.search_tax_decisions(text[], text, int) to service_role;
