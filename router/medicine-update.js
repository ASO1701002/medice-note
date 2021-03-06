const Router = require('koa-router');
const router = new Router();
const connection = require('../app/db');
const app = require('../app/app');

/* session
    update_medicine_id: 更新する薬情報の薬ID
    update_denied_error: 薬情報変更失敗時のエラーメッセージ　
    update_denied_request: 薬情報変更失敗時のリクエスト内容
*/

router.get('/medicine-update/:medicine_id', async (ctx) => {
    let session = ctx.session;

    let userId = await app.getUserId(session.auth_id);
    if (userId === false) {
        return ctx.redirect('/')
    }
    let medicineId = ctx.params['medicine_id'];

    let result = {};
    result['data'] = {};
    if (session.update_denied_error) {
        result['data']['errorMsg'] = session.update_denied_error;
        session.update_denied_error = null;
    }

    let medicineData = await app.getMedicine(medicineId, userId);
    if (medicineData === false) {
        // 薬一覧に遷移するように後で変更する。
        return ctx.redirect('/');
    }

    // renderに渡す為にデータを成形
    result['data']['request'] = {};
    result['data']['request']['medicineId'] = medicineId;
    result['data']['request']['takeTime'] = [];
    result['data']['request']['takeTime'] = medicineData[1];
    for (let key in medicineData[0]) {
        if (medicineData[0].hasOwnProperty(key)) {
            result['data']['request'][key] = medicineData[0][key];
        }
    }
    await ctx.render('/medicine-update', result);
})

router.post('/medicine-update/:medicine_id', async (ctx) => {
    let session = ctx.session;

    let userId = await app.getUserId(session.auth_id);
    if (userId === false) {
        return ctx.redirect('/')
    }
    let medicineId = ctx.params['medicine_id'];

    let medicineData = app.getMedicine(medicineId, userId);
    // 更新権限の有無の確認。間違えて使わないように確認後はnullで初期化。
    if (medicineData === false) {
        // 薬一覧に遷移するように後で変更する。
        return ctx.redirect('/');
    }
    medicineData = null;

    // 必須項目
    let medicineName = ctx.request.body['medicineName'];
    let hospitalName = ctx.request.body['hospitalName'];
    let number = ctx.request.body['number'];
    let startsDate = ctx.request.body['startsDate'];
    let period = ctx.request.body['period'];
    let medicineType = ctx.request.body['medicineType'];
    let takeTimeArray = ctx.request.body['takeTime'] || [];

    // 任意項目
    let image = "";
    let description = ctx.request.body['description'] || '';

    let getGroupId = 'SELECT group_id as groupId FROM medicine WHERE medicine_id = ?;';
    let groupId = (await connection.query(getGroupId, [medicineId]))[0][0]['groupId'];

    let validationArray = [medicineName, hospitalName, number,
        startsDate, period, medicineType, image, description, String(groupId)];
    let updateArgs = [medicineName, hospitalName, number,
        startsDate, period, medicineType, image, description, medicineId];

    // 検証パス時は値をDBに保存し、検証拒否時はエラーメッセージを表示
    let validationPromise = [];
    let validationResultArray = [];
    validationPromise[0] = app.medicineValidation(validationArray, userId).then(result => validationResultArray[0] = result);
    validationPromise[1] = app.takeTimeValidation(takeTimeArray).then(result => validationResultArray[1] = result);
    await Promise.all(validationPromise);
    // 更新情報検証成功時
    if (validationResultArray[0].is_success && validationResultArray[1].is_success) {
        let sql = 'UPDATE medicine ' +
            'SET medicine_name=?,hospital_name=?,number=?,' +
            'starts_date=?,period=?,type_id=?,image=?,description=? ' +
            'WHERE medicine_id = ?';
        await connection.query(sql, updateArgs);

        // 現在のtake_timeテーブルに登録されている情報を取得
        let currentTakeTimeSQL = 'SELECT take_time_id as takeTimeId FROM medicine_take_time WHERE medicine_id = ?;';
        let currentTakeTimeResult = (await connection.query(currentTakeTimeSQL, [medicineId]))[0];
        let currentTakeTimeArray = [];
        for (let row of currentTakeTimeResult) {
            currentTakeTimeArray.push(row['takeTimeId']);
        }
        // 削除する項目の判定
        let updateTakeTime = [[], []]
        for (let row of currentTakeTimeArray) {
            updateTakeTime[0].push(row);
            if (takeTimeArray.indexOf(row) < 0) {
                updateTakeTime[1].push('DELETE');
            } else {
                updateTakeTime[1].push('NO_CHANGE');
            }
        }
        // 追加すべき項目の判定
        for (let row of takeTimeArray) {
            if (currentTakeTimeArray.indexOf(row) < 0) {
                updateTakeTime[0].push(row);
                updateTakeTime[1].push('INSERT');
            }
        }
        for (let index in updateTakeTime[0]) {
            if (updateTakeTime[0].hasOwnProperty(index)) {
                switch (updateTakeTime[1][index]) {
                    case 'NO_CHANGE':
                        continue;
                    case 'DELETE': {
                        let sql = 'DELETE FROM medicine_take_time WHERE medicine_id = ? AND take_time_id = ?;'
                        await connection.query(sql, [medicineId, updateTakeTime[0][index]]);
                        break;
                    }
                    case 'INSERT': {
                        let sql = 'INSERT INTO medicine_take_time VALUES(?,?);'
                        await connection.query(sql, [medicineId, updateTakeTime[0][index]]);
                        break;
                    }
                }
            } else {
                console.log("it dose not have own property");
            }
        }
        return ctx.redirect('/medicine-update/' + medicineId);
    } else {
        // 更新情報検証失敗時
        if (validationResultArray[1].errors.array === '') {
            validationResultArray[0].errors.takeTime = validationResultArray[1].errors.items[0];
        } else {
            validationResultArray[0].errors.takeTime = validationResultArray[1].errors.array;
        }
        validationResultArray[0].request.takeTime = takeTimeArray;
        session.update_denied_request = validationResultArray[0].request;
        session.update_denied_error = validationResultArray[0].errors;
        return ctx.redirect('/medicine-update/' + medicineId);
    }
})

module.exports = router;