const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { ApiError, asyncHandler } = require('../utils');
const router = express.Router();

const definitions = {
  countdown: { table:'countdowns', order:'event_date ASC', fields:{ title:'title',date:'event_date',description:'description',isAnniversary:'is_anniversary',isTop:'is_top' } },
  album: { table:'albums', order:'created_at DESC', fields:{ imgUrl:'image_url',fileID:'storage_key',description:'description',date:'photo_date' } },
  tasks: { table:'tasks', order:'created_at DESC', fields:{ title:'title',description:'description',status:'status',completed:'status',completedAt:'completed_at' } },
  menus: { table:'menus', order:'created_at DESC', json:['dishes'], fields:{ name:'name',mealType:'meal_type',dishes:'dishes',imageUrl:'image_url',imgUrl:'image_url' } },
  orders: { table:'orders', order:'created_at DESC', json:['dishes','menuNames'], fields:{ dishes:'dishes',menuNames:'menu_names',mealType:'meal_type',orderBy:'order_by',note:'note',status:'status',acceptedBy:'accepted_by',acceptedTime:'accepted_at',completedAt:'completed_at' } }
};
const bools = new Set(['is_anniversary','is_top']);
function definition(name){const d=definitions[name];if(!d)throw new ApiError(404,'资源不存在');return d;}
function output(row,d){const item={_id:String(row.id),coupleId:String(row.couple_id),author:row.author_name||'',createTime:row.created_at,createdAt:row.created_at};for(const [client,column] of Object.entries(d.fields)){let value=row[column];if(d.json?.includes(client)&&typeof value==='string'){try{value=JSON.parse(value)}catch{value=[]}}if(bools.has(column))value=Boolean(value);if(client==='completed')value=row.status==='completed';item[client]=value;}return item;}
function input(body,d){const result={};for(const [client,column] of Object.entries(d.fields)){if(body[client]===undefined)continue;let value=body[client];if(client==='completed')value=value?'completed':'pending';if(d.json?.includes(client))value=JSON.stringify(value||[]);if(bools.has(column))value=value?1:0;result[column]=value;}return result;}
const ensureCouple=req=>{if(!req.userRow.couple_id)throw new ApiError(409,'请先绑定情侣');return req.userRow.couple_id;};
router.use(requireAuth);
router.get('/:resource',asyncHandler(async(req,res)=>{const d=definition(req.params.resource),coupleId=ensureCouple(req);const limit=Math.min(Math.max(Number(req.query.limit)||100,1),200);const [rows]=await pool.query(`SELECT r.*,u.name author_name FROM ${d.table} r JOIN users u ON u.id=r.author_id WHERE r.couple_id=? ORDER BY ${d.order} LIMIT ?`,[coupleId,limit]);res.json({success:true,data:rows.map(x=>output(x,d))});}));
router.get('/:resource/:id',asyncHandler(async(req,res)=>{const d=definition(req.params.resource),coupleId=ensureCouple(req);const [rows]=await pool.query(`SELECT r.*,u.name author_name FROM ${d.table} r JOIN users u ON u.id=r.author_id WHERE r.id=? AND r.couple_id=? LIMIT 1`,[req.params.id,coupleId]);if(!rows[0])throw new ApiError(404,'数据不存在');res.json({success:true,data:output(rows[0],d)});}));
router.post('/:resource',asyncHandler(async(req,res)=>{const d=definition(req.params.resource),coupleId=ensureCouple(req),data=input(req.body||{},d),keys=Object.keys(data);if(!keys.length)throw new ApiError(400,'没有可保存的数据');const [r]=await pool.query(`INSERT INTO ${d.table} (couple_id,author_id,${keys.join(',')}) VALUES (?, ?, ${keys.map(()=>'?').join(',')})`,[coupleId,req.userRow.id,...keys.map(k=>data[k])]);if(req.params.resource==='countdown'&&data.is_anniversary===1)await pool.query('UPDATE countdowns SET is_anniversary=0 WHERE couple_id=? AND id<>?',[coupleId,r.insertId]);res.status(201).json({success:true,data:{_id:String(r.insertId)}});}));
router.patch('/:resource/:id',asyncHandler(async(req,res)=>{const d=definition(req.params.resource),coupleId=ensureCouple(req),data=input(req.body||{},d),keys=Object.keys(data);if(!keys.length)throw new ApiError(400,'没有可更新的数据');const [r]=await pool.query(`UPDATE ${d.table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=? AND couple_id=?`,[...keys.map(k=>data[k]),req.params.id,coupleId]);if(!r.affectedRows)throw new ApiError(404,'数据不存在');if(req.params.resource==='countdown'&&data.is_anniversary===1)await pool.query('UPDATE countdowns SET is_anniversary=0 WHERE couple_id=? AND id<>?',[coupleId,req.params.id]);res.json({success:true,data:null});}));
router.delete('/:resource/:id',asyncHandler(async(req,res)=>{const d=definition(req.params.resource),coupleId=ensureCouple(req);const [r]=await pool.query(`DELETE FROM ${d.table} WHERE id=? AND couple_id=?`,[req.params.id,coupleId]);if(!r.affectedRows)throw new ApiError(404,'数据不存在');res.json({success:true,data:null});}));
module.exports=router;
