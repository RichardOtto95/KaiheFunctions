const functions = require("firebase-functions");

const admin = require('firebase-admin');


var moment = require('moment-timezone');

admin.initializeApp();

const messaging = admin.messaging();

var db = admin.firestore();

exports.registrateUser = functions.https.onCall(async (data, context) => {
    // data.query = [email, phone, type, username, seconds, milliseconds, nanoseconds];

    if (!data.email) {
        return 'Email inválido';
    }


    let userQuery = await db.collection("preregistrations").where("email", "==", data.email).get();

    if (!/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(data.email)) {
        return 'Email inválido';
    } else if (userQuery.docs.length != 0) {
        return 'Email já registrado';
    } else if (!data.phone || data.phone.length != 11) {
        return 'Número de telefone inválido';
    } else if (!data.username) {
        return 'Nome de usuário inválido';
    } else if (!data.seconds || data.nanoseconds == undefined || moment(data.milliseconds).isAfter(moment(Date.now())) || moment(data.milliseconds).isBefore(moment('1900-01-01'))) {
        return "Data de nascimento inválida";
    }

    var newUser = {
        avatar: null,
        birthday: new admin.firestore.Timestamp(data.seconds, data.nanoseconds),
        country: "Brasil",
        created_at: admin.firestore.Timestamp.now(),
        email: data.email,
        id: null,
        phone: data.phone,
        status: "PENDING",
        text_message: null,
        type: data.type,
        username: data.username,
    };

    var userRef = db.collection('preregistrations').doc();

    await userRef.set(newUser);
    await userRef.update({ "id": userRef.id });
});


exports.signUp = functions.https.onCall(async (data, res) => {
    // data.query = [email, type, password, confirmPassword, token];

    const preregistrationQuery = await db.collection("preregistrations").where("type", "==", data.type).where("email", "==", data.email).get();

    if (preregistrationQuery.docs.length == 0) {
        return prepareResponseLegacy(null, { msg: "Não registrado" });
    }

    const preregistration = preregistrationQuery.docs[0];

    let password = new String(data.password);

    if (!data.password || !password.match(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/)) {
        console.log("password " + password + " " + password.match(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/));
        return prepareResponseLegacy(null, { msg: "Senha inválida" });
    } else if (data.password != data.confirmPassword) {
        return prepareResponseLegacy(null, { msg: "As senhas não coincidem" });
    }


    var authUser = {
        email: data.email,
        emailVerified: true,
        password: data.password,
        disabled: false
    };

    let userQuery;

    if (data.type = "TEACHER") {
        userQuery = await db.collection("teachers").where("type", "==", data.type).where("email", "==", data.email).get();
    }

    let finalResponse;

    if (userQuery.docs.length == 0) {
        await admin.auth().createUser(authUser)
            .then(async function (userRecord) {
                // if (userRecord.emailVerified) {
                if (data.type == "TEACHER") {
                    const teacherRef = db.collection("teachers").doc(userRecord.uid);
                    await teacherRef.set(preregistration.data());

                    await teacherRef.update({
                        id: userRecord.uid,
                        created_at: admin.firestore.FieldValue.serverTimestamp(),
                        notification_enabled: true,
                        status: 'ACTIVE',
                        connected: true,
                        country: 'Brasil',
                        token_id: data.token,
                    });

                    await preregistration.ref.update({ "status": "REGISTERED" });
                }
                // } else {
                admin.auth().generateEmailVerificationLink(userRecord.email);
                // }

                finalResponse = prepareResponseLegacy(userRecord.uid, null);
            }).catch(function (error) {
                console.log("Error creating new user: ", error);
                finalResponse = prepareResponseLegacy(null, {
                    code: 1,
                    msg: "Email inválido ou já cadastrado.",
                });
            });
    } else {
        return prepareResponseLegacy(null, { msg: "Já existe uma conta com este email" });
    }

    return finalResponse;
});

exports.signIn = functions.https.onCall(async (data, context) => {
    // data = [email, password, confirmPassword, type];

    if (!data.password || !data.password.match(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/)) {
        console.log("password " + password + " " + data.password.match(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/));
        return prepareResponseLegacy(null, { msg: "Senha inválida" });
    } else if (data.password != data.confirmPassword) {
        return prepareResponseLegacy(null, { msg: "As senhas não coincidem" });
    }

    let userQuery;

    if (data.type = "TEACHER") {
        userQuery = await db.collection("teachers").where("type", "==", data.type).where("email", "==", data.email).get();
    }

    if (userQuery.docs.length == 0) {
        return prepareResponseLegacy(null, { msg: "Usuário não cadastrado" });
    }

    let _user = await admin.auth().getUserByEmail(data.email);

    if (_user.emailVerified) {
        return prepareResponseLegacy(userQuery.docs[0].data(), null);
    } else {
        return prepareResponseLegacy(null, { msg: "Verifique o email para poder logar" });
    }

});

exports.sendNotification = functions.https.onCall(async (data, context) => {
    const title = data.title;
    const text = data.text;
    const userId = data.userId;
    const userCollection = data.userCollection;

    const payload = {
        notification: {
            title: title ? title : "Kaihe",
            body: text,
        }
    }

    const userDoc = await db.collection(userCollection).doc(userId).get();

    let responseMessage;

    await messaging.sendToDevice(userDoc.get("token_id"), payload).then(async function (res) {
        responseMessage = prepareResponseLegacy(null, { msg: "Mensagem enviada com sucesso" });
    }).catch(function (error) {
        responseMessage = prepareResponseLegacy(null, { msg: "Erro ao enviar a mensagem" });
    });

    return responseMessage;
});

exports.createStudent = functions.https.onCall(async (data, context) => {
    let studentRef = await db.collection("students").add(data.data);

    await studentRef.update({
        "id": studentRef.id,
        "birthday": new admin.firestore.Timestamp(data.birthday.seconds, data.birthday.nanoseconds),
        "created_at": admin.firestore.FieldValue.serverTimestamp(),
        "last_view": admin.firestore.FieldValue.serverTimestamp(),
    });

    return (await studentRef.get()).data();
});

exports.getStudent = functions.https.onCall(async (data, context) => {
    return (await db.collection("students").doc(data.studentId).get()).data();
});

exports.updateStudent = functions.https.onCall(async (data, context) => {
    let studentData = data.studentData;

    if (studentData.birthday) {
        const birthday = studentData.birthday;
        studentData.birthday = new admin.firestore.Timestamp(birthday.seconds, birthday.nanoseconds);
    }
    if (studentData.last_view) {
        const lastView = studentData.last_view;
        studentData.last_view = new admin.firestore.Timestamp(lastView.seconds, lastView.nanoseconds);
    }

    await db.collection("students").doc(data.studentId).update(studentData);

    return await db.collection("students").doc(data.studentId).get();
});

exports.deleteStudent = functions.https.onCall(async (data, context) => {
    await db.collection("students").doc(data.studentId).update({ "status": "DELETED" });
});

exports.getTeacher = functions.https.onCall(async (data, context) => {
    return (await db.collection("teachers").doc(data.teacherId).get()).data();
});

exports.updateTeacher = functions.https.onCall(async (data, context) => {
    let teacherData = data.teacherData;

    if (teacherData.birthday) {
        const birthday = teacherData.birthday;
        teacherData.birthday = new admin.firestore.Timestamp(birthday.seconds, birthday.nanoseconds);
    }

    await db.collection("teachers").doc(data.teacherId).update(teacherData);

    return await db.collection("teachers").doc(data.teacherId).get();
});

exports.deleteTeacher = functions.https.onCall(async (data, context) => {
    await db.collection("teachers").doc(data.teacherId).update({ "status": "DELETED" });
});

exports.createHomework = functions.https.onCall(async (data, context) => {
    const homeworkData = data.homeworkData;
    const activityData = data.activityData;
    const studentsList = data.studentsList;
    const classId = data.classId;

    const homeworkRef = await db.collection("classes").doc(classId).collection("homeworks").add(homeworkData);
    await homeworkRef.update({ id: homeworkRef.id, created_at: admin.firestore.FieldValue.serverTimestamp() });

    for (let studentId of studentsList) {
        const actRef = await db.collection("classes").doc(classId).collection("activities").add(activityData);
        await actRef.update({ id: actRef.id, student_id: studentId, homework_id: homeworkRef.id, created_at: admin.firestore.FieldValue.serverTimestamp() });

        const actCurData = (await actRef.get()).data();

        await db.collection("students").doc(studentId).collection("homeworks").doc(actRef.id).set(actCurData);
    }
});

exports.getHomework = functions.https.onCall(async (data, context) => {
    const studentId = data.studentId;
    const activitieId = data.activitieId;

    const studentDoc = await db.collection("students").doc(studentId).get();
    const activitieDoc = await studentDoc.ref.collection("homeworks").doc(activitieId).get();
    const homeworkDoc = await db.collection("classes").doc(activitieDoc.get("class_id")).collection("homeworks").doc(activitieDoc.get("homework_id")).get();

    return {
        activitie: activitieDoc.data(),
        homework: homeworkDoc.data(),
    };
});

exports.updateHomework = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const activityId = data.activityId;
    const activityData = data.activityData;
    const homeworkData = data.homeworkData;

    const clsRef = db.collection("classes").doc(classId);
    const actRef = db.collection("classes").doc(classId).collection("activities").doc(activityId);

    if (activityData) {
        await actRef.update(activityData);
        await db.collection("students").doc((await actRef.get()).get("student_id")).collection("homework").doc(actRef.id).update(activityData);
    }
    let homeworks = await clsRef.collection("activities").where("activity", "==", "HOMEWORK").get();

    if (homeworkData) {
        clsRef.collection("homeworks").doc((await actRef.get()).get("homework_id")).update(homeworkData);
    }
});

exports.deleteHomework = functions.https.onCall(async (data, context) => {
    const activityId = data.activityId;
    const classId = data.classId;

    const clsRef = db.collection("classes").doc(classId);
    const actDoc = await clsRef.collection("activities").doc(activityId).get();

    await actDoc.ref.update({ status: "DELETED" });
    await clsRef.collection("homeworks").doc(actDoc.get("homework_id")).update({ status: "DELETED" });
    await db.collection("students").doc(actDoc.get("student_id")).collection("homeworks").doc(actDoc.id).update({ status: "DELETED" });
});

exports.createAttendence = functions.https.onCall(async (data, context) => {
    const studentsList = data.studentsList;
    const activityData = data.activityData;
    const classId = data.classId;

    for (let studentId of studentsList) {
        const actRef = await db.collection("classes").doc(classId).collection("activities").add(activityData);

        await actRef.update({ id: actRef.id, created_at: admin.firestore.Timestamp.now(), student_id: studentId });

        const actData = (await actRef.get()).data();

        await db.collection("students").doc(studentId).collection("attendences").doc(actRef.id).set(actData);
    }
});

exports.getAttendence = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    return (await db.collection("classes").doc(classId).collection("activities").doc(actvityId).get()).data();
});

exports.updateAttendence = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    const activityData = data.activityData;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);
    console.log(`activityData: ${activityData}`);
    await actRef.update(activityData);
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("attendences").doc(actRef.id).update(activityData);
});

exports.deleteAttendence = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update({ status: "DELETED" });
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("attendences").doc(actRef.id).update({ status: "DELETED" });
});

exports.createNote = functions.https.onCall(async (data, context) => {
    const studentsList = data.studentsList;
    const activityData = data.activityData;
    const classId = data.classId;

    for (let studentId of studentsList) {
        const actRef = await db.collection("classes").doc(classId).collection("activities").add(activityData);

        await actRef.update({ id: actRef.id, created_at: admin.firestore.Timestamp.now(), student_id: studentId });

        const actData = (await actRef.get()).data();

        await db.collection("students").doc(studentId).collection("notes").doc(actRef.id).set(actData);
    }
});

exports.getNote = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    return (await db.collection("classes").doc(classId).collection("activities").doc(actvityId).get()).data();
});

exports.updateNote = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    const activityData = data.activityData;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update(activityData);
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("notes").doc(actRef.id).update(activityData);
});

exports.deleteNote = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update({ status: "DELETED" });
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("notes").doc(actRef.id).update({ status: "DELETED" });
});

exports.createBathroom = functions.https.onCall(async (data, context) => {
    const studentsList = data.studentsList;
    const activityData = data.activityData;
    const classId = data.classId;

    for (let studentId of studentsList) {
        const actRef = await db.collection("classes").doc(classId).collection("activities").add(activityData);

        await actRef.update({ id: actRef.id, created_at: admin.firestore.Timestamp.now(), student_id: studentId });

        const actData = (await actRef.get()).data();

        await db.collection("students").doc(studentId).collection("bathroom").doc(actRef.id).set(actData);
    }
});

exports.getBathroom = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    return (await db.collection("classes").doc(classId).collection("activities").doc(actvityId).get()).data();
});

exports.updateBathroom = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    const activityData = data.activityData;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update(activityData);
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("bathroom").doc(actRef.id).update(activityData);
});

exports.deleteBathroom = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update({ status: "DELETED" });
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("bathroom").doc(actRef.id).update({ status: "DELETED" });
});

exports.createFood = functions.https.onCall(async (data, context) => {
    const studentsList = data.studentsList;
    const activityData = data.activityData;
    const classId = data.classId;

    for (let studentId of studentsList) {
        const actRef = await db.collection("classes").doc(classId).collection("activities").add(activityData);

        await actRef.update({ id: actRef.id, created_at: admin.firestore.Timestamp.now(), student_id: studentId });

        const actData = (await actRef.get()).data();

        await db.collection("students").doc(studentId).collection("food").doc(actRef.id).set(actData);
    }
});

exports.getFood = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    return (await db.collection("classes").doc(classId).collection("activities").doc(actvityId).get()).data();
});

exports.updateFood = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    const activityData = data.activityData;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update(activityData);
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("food").doc(actRef.id).update(activityData);
});

exports.deleteFood = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update({ status: "DELETED" });
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("food").doc(actRef.id).update({ status: "DELETED" });
});


exports.createMoment = functions.https.onCall(async (data, context) => {
    const studentsList = data.studentsList;
    const activityData = data.activityData;
    const classId = data.classId;

    for (let studentId of studentsList) {
        const actRef = await db.collection("classes").doc(classId).collection("activities").add(activityData);

        await actRef.update({ id: actRef.id, created_at: admin.firestore.Timestamp.now(), student_id: studentId });

        const actData = (await actRef.get()).data();

        await db.collection("students").doc(studentId).collection("moments").doc(actRef.id).set(actData);
    }
});

exports.getMoment = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    return (await db.collection("classes").doc(classId).collection("activities").doc(actvityId).get()).data();
});

exports.updateMoment = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    const activityData = data.activityData;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update(activityData);
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("moments").doc(actRef.id).update(activityData);
});

exports.deleteMoment = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update({ status: "DELETED" });
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("moments").doc(actRef.id).update({ status: "DELETED" });
});


exports.createSleep = functions.https.onCall(async (data, context) => {
    const studentsList = data.studentsList;
    let activityData = data.activityData;
    const classId = data.classId;

    activityData.start = new admin.firestore.Timestamp(activityData.start.seconds, activityData.start.nanoseconds);

    for (let studentId of studentsList) {
        const actRef = await db.collection("classes").doc(classId).collection("activities").add(activityData);

        await actRef.update({ id: actRef.id, created_at: admin.firestore.Timestamp.now(), student_id: studentId });

        const actData = (await actRef.get()).data();

        await db.collection("students").doc(studentId).collection("sleeps").doc(actRef.id).set(actData);
    }
});

exports.getSleep = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    return (await db.collection("classes").doc(classId).collection("activities").doc(actvityId).get()).data();
});

exports.updateSleep = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;
    let activityData = data.activityData;

    if (activityData.start) {
        activityData.start = new admin.firestore.Timestamp(activityData.start.seconds, activityData.start.nanoseconds);
    }

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update(activityData);
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("sleeps").doc(actRef.id).update(activityData);
});

exports.deleteSleep = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const actvityId = data.actvityId;

    const actRef = db.collection("classes").doc(classId).collection("activities").doc(actvityId);

    await actRef.update({ status: "DELETED" });
    await db.collection("students").doc((await actRef.get()).get("student_id")).collection("sleeps").doc(actRef.id).update({ status: "DELETED" });
});

exports.createClass = functions.https.onCall(async (data, context) => {
    const classData = data.classData;

    const clsRef = await db.collection("classes").add(classData);

    await clsRef.update({ id: clsRef.id, created_at: admin.firestore.Timestamp.now() });
});

exports.getClass = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    return (await db.collection("classes").doc(classId).get()).data();
});

exports.updateClass = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const classData = data.classData;

    const clsRef = db.collection("classes").doc(classId);

    await clsRef.update(classData);
});

exports.deleteClass = functions.https.onCall(async (data, context) => {
    const classId = data.classId;

    const clsRef = db.collection("classes").doc(classId);

    await clsRef.update({ status: "DELETED" });
});


exports.createSchool = functions.https.onCall(async (data, context) => {
    const schoolData = data.schoolData;

    const clsRef = await db.collection("schools").add(schoolData);

    await clsRef.update({ id: clsRef.id, created_at: admin.firestore.Timestamp.now() });
});

exports.getSchool = functions.https.onCall(async (data, context) => {
    const schoolId = data.schoolId;
    return (await db.collection("schools").doc(schoolId).get()).data();
});

exports.updateSchool = functions.https.onCall(async (data, context) => {
    const schoolId = data.schoolId;
    const schoolData = data.schoolData;

    const clsRef = db.collection("schools").doc(schoolId);

    await clsRef.update(schoolData);
});

exports.deleteSchool = functions.https.onCall(async (data, context) => {
    const schoolId = data.schoolId;

    const clsRef = db.collection("schools").doc(schoolId);

    await clsRef.update({ status: "DELETED" });
});

exports.addStudents = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const studentsList = data.studentsList;

    for (let studentId of studentsList) {
        await db.collection("students").doc(studentId).update({ class_id: classId });
    }
});

exports.removeStudents = functions.https.onCall(async (data, context) => {
    const studentsList = data.studentsList;

    for (let studentId of studentsList) {
        await db.collection("students").doc(studentId).update({ class_id: null });
    }
});

exports.addTeachers = functions.https.onCall(async (data, context) => {
    const classId = data.classId;
    const teachersList = data.teachersList;

    for (let teacherId of teachersList) {
        const teaRef = db.collection("classes").doc(classId).collection("teachers").doc(teacherId);

        await teaRef.set({ created_at: admin.firestore.FieldValue.serverTimestamp(), status: "ACTIVE", id: teaRef.id });

        await db.collection("teachers").doc(teacherId).collection("classes").doc(classId).set({ "created_at": admin.firestore.FieldValue.serverTimestamp(), "id": classId });
    }
});

exports.createChat = functions.https.onCall(async (data, context) => {
    const chatData = data.chatData;
    const classId = data.classId;

    const chatRef = await db.collection("classes").doc(classId).collection("chats").add(chatData);

    await chatRef.update({ id: chatRef.id, created_at: admin.firestore.Timestamp.now(), updated_at: admin.firestore.Timestamp.now() });
});

exports.getChat = functions.https.onCall(async (data, context) => {
    const chatId = data.chatId;
    const classId = data.classId;
    return (await db.collection("classes").doc(classId).collection("chats").doc(chatId).get()).data();

});

exports.updateChat = functions.https.onCall(async (data, context) => {
    const chatId = data.chatId;
    let chatData = data.chatData;
    const classId = data.classId;

    if (chatData.updated_at) {
        chatData.updated_at = new admin.firestore.Timestamp(chatData.updated_at.seconds, chatData.updated_at.nanoseconds);
    }

    const clsRef = db.collection("classes").doc(classId).collection("chats").doc(chatId);

    await clsRef.update(chatData);
});

exports.deleteChat = functions.https.onCall(async (data, context) => {
    const chatId = data.chatId;
    const classId = data.classId;

    const clsRef = db.collection("classes").doc(classId).collection("chats").doc(chatId);

    await clsRef.update({ status: "DELETED" });
});

exports.createMessage = functions.https.onCall(async (data, context) => {
    const chatId = data.chatId;
    const messageData = data.messageData;
    const classId = data.classId;

    const chatDoc = await db.collection("classes").doc(classId).collection("chats").doc(chatId).get();

    if (!chatDoc.exists) {
        return false
    }

    const mesRef = await chatDoc.ref.collection("messages").add(messageData);

    await mesRef.update({ id: mesRef.id, created_at: admin.firestore.FieldValue.serverTimestamp() })

    return true;
});

exports.getMessage = functions.https.onCall(async (data, context) => {
    const chatId = data.chatId;
    const messageId = data.messageId;
    const classId = data.classId;

    return (await db.collection("classes").doc(classId).collection("chats").doc(chatId).collection("messages").doc(messageId).get()).data();
});

exports.updateMessage = functions.https.onCall(async (data, context) => {
    const chatId = data.chatId;
    const messageId = data.messageId;
    const messageData = data.messageData;
    const classId = data.classId;

    await db.collection("classes").doc(classId).collection("chats").doc(chatId).collection("messages").doc(messageId).update(messageData);
});

exports.deleteMessage = functions.https.onCall(async (data, context) => {
    const chatId = data.chatId;
    const messageId = data.messageId;
    const classId = data.classId;

    await db.collection("classes").doc(classId).collection("chats").doc(chatId).collection("messages").doc(messageId).update({ status: "DELETED" });
});

// exports.functionName = functions.https.onCall(async (data, context) => { });

function prepareResponseLegacy(data, error) {
    // error : {
    // code: int,
    // msg: msg,
    // }

    return {
        "ErrorCode": error ? error.code : 0,
        "isError": error != null,
        "ErrorMsg": error ? error.msg : "",
        "Data": data ? data : []
    }
}
