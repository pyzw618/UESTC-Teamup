-- 招募帖不再根据竞赛时间自动失效 / 自动置为 COMPETING：
-- 历史 COMPETING 数据回到招募中，之后只由发帖人或管理员主动归档。
UPDATE "Team" SET "status" = 'RECRUITING' WHERE "status" = 'COMPETING';
