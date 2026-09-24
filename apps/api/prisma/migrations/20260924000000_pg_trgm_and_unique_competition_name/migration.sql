-- H4：搜索接口使用 similarity() 与 % 操作符（见 apps/api/src/modules/radar/search.service.ts），
-- 但此前 9 个迁移均未创建 pg_trgm 扩展，导致线上搜索必 500。此处补建扩展与 GIN 索引。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Competition_name_trgm_idx" ON "Competition" USING GIN ("name" gin_trgm_ops);

-- M2 配套：竞赛名唯一索引（与 schema.prisma 的 Competition.name @unique 对应）
-- 注意：若历史数据已存在同名 Competition，需先人工去重再执行本迁移
CREATE UNIQUE INDEX IF NOT EXISTS "Competition_name_key" ON "Competition"("name");