"use strict";

const express = require('express');
const router = express.Router();
const auth = require('../../services/auth');
const sql = require('../../services/sql');
const notes = require('../../services/notes');
const log = require('../../services/log');
const utils = require('../../services/utils');
const protected_session = require('../../services/protected_session');
const tree = require('../../services/tree');
const sync_table = require('../../services/sync_table');
const wrap = require('express-promise-wrap').wrap;

router.get('/:noteId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteId = req.params.noteId;

    const detail = await sql.getFirst("SELECT * FROM notes WHERE noteId = ?", [noteId]);

    if (!detail) {
        log.info("Note " + noteId + " has not been found.");

        return res.status(404).send({});
    }

    protected_session.decryptNote(req, detail);

    res.send({
        detail: detail
    });
}));

router.post('/:parentNoteId/children', auth.checkApiAuth, wrap(async (req, res, next) => {
    const sourceId = req.headers.source_id;
    const parentNoteId = req.params.parentNoteId;
    const newNote = req.body;

    await sql.doInTransaction(async () => {
        const { noteId, noteTreeId, note } = await notes.createNewNote(parentNoteId, newNote, req, sourceId);

        res.send({
            'noteId': noteId,
            'noteTreeId': noteTreeId,
            'note': note
        });
    });
}));

router.put('/:noteId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const note = req.body;
    const noteId = req.params.noteId;
    const sourceId = req.headers.source_id;
    const dataKey = protected_session.getDataKey(req);

    await notes.updateNote(noteId, note, dataKey, sourceId);

    res.send({});
}));

router.get('/', auth.checkApiAuth, wrap(async (req, res, next) => {
    const search = '%' + utils.sanitizeSql(req.query.search) + '%';

    // searching in protected notes is pointless because of encryption
    const noteIds = await sql.getFirstColumn(`SELECT noteId FROM notes 
              WHERE isDeleted = 0 AND isProtected = 0 AND (title LIKE ? OR content LIKE ?)`, [search, search]);

    res.send(noteIds);
}));

router.put('/:noteId/sort', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteId = req.params.noteId;
    const sourceId = req.headers.source_id;
    const dataKey = protected_session.getDataKey(req);

    await tree.sortNotesAlphabetically(noteId, dataKey, sourceId);

    res.send({});
}));

router.put('/:noteId/protect-sub-tree/:isProtected', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteId = req.params.noteId;
    const isProtected = !!parseInt(req.params.isProtected);
    const dataKey = protected_session.getDataKey(req);
    const sourceId = req.headers.source_id;

    await sql.doInTransaction(async () => {
        await notes.protectNoteRecursively(noteId, dataKey, isProtected, sourceId);
    });

    res.send({});
}));

router.put(/\/(.*)\/type\/(.*)\/mime\/(.*)/, auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteId = req.params[0];
    const type = req.params[1];
    const mime = req.params[2];
    const sourceId = req.headers.source_id;

    await sql.doInTransaction(async () => {
       await sql.execute("UPDATE notes SET type = ?, mime = ?, dateModified = ? WHERE noteId = ?",
           [type, mime, utils.nowDate(), noteId]);

       await sync_table.addNoteSync(noteId, sourceId);
    });

    res.send({});
}));

module.exports = router;