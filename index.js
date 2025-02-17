var AWS = require('aws-sdk');
var request = require('request');
var ses = new AWS.SES({apiVersion: '2010-12-01'});
var sqs = new AWS.SQS({region: process.env.Region, httpOptions: {agent: agent}});
var s3 = new AWS.S3();
var https = require('https');
var agent = new https.Agent({maxSockets: 150});
var fs = require('fs');
var queueURL = process.env.QueueURL;
var toddresses = process.env.ToAddr;
var srcaddr = process.env.SrcAddr;
var bucket = process.env.BucketName;
var prefix = process.env.BucketPrefix;
var slackToken = process.env.slackToken;
var qSize = null;
var content = null;
var queueParams = {AttributeNames: ["ApproximateNumberOfMessages"], QueueUrl: queueURL};


exports.handler = (event, context, callback) => {
    var date = (new Date()).toString().split(' ').splice(1, 4).join('-');
    var url = null;
    var filename = date + ".html";

    function s3upload() {
        if (prefix == undefined) {
            prefix = "";
        }
        var param = {
            Bucket: bucket,
            Key: prefix + filename,
            Body: content,
            ACL: 'private',
            ContentType: "text/html"
        };
        s3.upload(param, function (err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else console.log(data);
            url = data.Location;
            console.log("uploading to s3");
            if (toddresses) {
                sendMail();
            }
            if (slackToken) {
                sendToSlack();
            }
            //context.done();
        });
    }

    function sendToSlack() {
        request.post({
            url: 'https://slack.com/api/files.upload',
            formData: {
                token: slackToken,
                title: "Synduit SES Email Report " + date,
                filename: filename,
                filetype: "html",
                channels: "monitoring",
                content: content,
            },
        }, function (err, response) {
            console.log(JSON.parse(response.body));
        });
    }

    function sendMail() {
        //console.log("message: " +  messages);
        var params = {
            Destination: {
                ToAddresses: [toddresses,]
            },
            Message: {
                Body: {
                    Html: {
                        Data: url,
                        Charset: 'utf-8'
                    },
                    Text: {
                        Data: "report",
                        Charset: 'utf-8'
                    }
                },
                Subject: {
                    Data: "[SES] Daily -  Notification Reports",
                    Charset: 'utf-8'
                }
            },
            Source: srcaddr,
        };
        ses.sendEmail(params, function (err, data) {
            if (err) console.log(err, err.stack);
            else console.log(data);
            console.log("sending email");
            context.done();
        });
    }

    function initializeQueue(callbackQueue) {
        console.log("Reading from: " + queueURL);
        sqs.getQueueAttributes(queueParams, (err, data) => {
            if (err) {
                console.log("Possible issue with SQS permissions or QueueURL wrong")
                callbackQueue(err, null);
            }
            qSize = data.Attributes.ApproximateNumberOfMessages;
            callbackQueue(null, qSize);
        });
    }

    function deleteMessage(message) {
        if (typeof message.ReceiptHandle !== 'undefined') {
            sqs.deleteMessage({
                QueueUrl: queueURL,
                ReceiptHandle: message.ReceiptHandle
            }, (err, data) => {
                if (err) {
                    console.log(err);
                    throw err;
                }
                // console.log("Data removed. Response = " + data);
            });
        }
    }

    //Start Receive message
    initializeQueue((err, queueSize) => {
        console.log("Reading queue, size = " + queueSize);

        if (queueSize == 0) {
            callback(null, 'Queue is empty.');
        }

        var messages = [];
        var msgBouncePerm = [];
        var msgSuppres = [];
        var msgBounceTrans = [];
        var msgComplaint = [];
        var msgDeliveries = [];

        var messagesProcessed = 0;
        for (var i = 0; i < queueSize; i++) {
            sqs.receiveMessage(queueParams, (err, data) => {
                if (err) {
                    console.log(err, err.stack);
                    throw err;
                }

                // console.log("data with message = " + data.Messages);
                if (data.Messages) {
                    var message = data.Messages[0];
                    body = JSON.parse(message.Body);
                    msg = JSON.parse(body.Message);

                    if (typeof msg !== 'undefined' && typeof msg.mail !== 'undefined') {
                        var destination = msg.mail.destination[0];
                        var type = msg.notificationType;
                        var time = msg.mail.timestamp;
                        var id = msg.mail.messageId;
                        var from = msg.mail.source;

                        if (typeof msg.mail.commonHeaders === 'undefined' || typeof msg.mail.commonHeaders.subject === 'undefined') {
                            var subject = 'undefined';
                        } else {
                            var subject = msg.mail.commonHeaders.subject;
                        }

                        var otr = "<tr>";
                        var ftr = "</tr>";
                        var oline = "<td>";
                        var cline = "</td>";
                        var btype = null;
                        var bsubtype = null;
                        var diagcode = null;

                        //console.log(msg);

                        if (type == "Bounce") {
                            btype = msg.bounce.bounceType; // Permanent || Transient
                            bsubtype = msg.bounce.bounceSubType; // General || Supressed
                            if (btype == "Permanent" && bsubtype == "Suppressed") {
                                diagcode = "Suppressed by SES";
                                text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;
                                msgSuppres.push(text);

                            } else if (btype == "Permanent" && bsubtype == "General") {
                                diagcode = msg.bounce.bouncedRecipients[0].diagnosticCode;
                                text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;
                                msgBouncePerm.push(text);

                            } else if (btype == "Permanent" && bsubtype == "NoEmail") {
                                diagcode = msg.bounce.bouncedRecipients[0].diagnosticCode;
                                text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;
                                msgBouncePerm.push(text);

                            } else if (btype == "Undetermined") {
                                diagcode = msg.bounce.bouncedRecipients[0].diagnosticCode;
                                text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;
                                msgBouncePerm.push(text);

                            } else if (btype == "Transient") {
                                if (typeof msg.bounce.bouncedRecipients !== 'undefined' &&
                                    typeof msg.bounce.bouncedRecipients[0] !== 'undefined' &&
                                    typeof msg.bounce.bouncedRecipients[0].diagnosticCode !== 'undefined') {
                                    diagcode = msg.bounce.bouncedRecipients[0].diagnosticCode;
                                } else {
                                    diagcode = "soft-Bounce";
                                }
                                text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;
                                msgBounceTrans.push(text);

                            } else {
                                console.log("it's an unknown bounce");
                                diagcode = "unknown";
                                text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;
                                msgBouncePerm.push(text);
                            }

                        } else if (type == "Delivery") {
                            diagcode = "null";
                            text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;
                            msgDeliveries.push(text);

                        } else if (type == "Complaint") {
                            btype = "null";
                            bsubtype = "null";
                            diagcode = "null";
                            text = otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + destination + cline + oline + diagcode + cline + oline + time + cline + oline + id + cline + oline + from + cline + oline + subject + cline + ftr;

                            msgComplaint.push(text);

                        }

                        else {
                            console.log("not identified");
                        }

                        messages.push(i);
                    }
                } else {
                    console.log("data without messages.");
                }

                deleteMessage(message);
                //console.log("Array size = " + messages.length + " with queue size = " + queueSize);

                messagesProcessed++;
                if (messagesProcessed == queueSize) {
                    var bp = msgBouncePerm.join('');
                    var sp = msgSuppres.join('');
                    var bt = msgBounceTrans.join('');
                    var cp = msgComplaint.join('');
                    var dl = msgDeliveries.join('');
                    var begin = fs.readFileSync('template/begin.html', 'utf8');
                    var middle = bp + sp + bt + cp + dl;
                    var end = fs.readFileSync('template/end.html', 'utf8');
                    content = begin + middle + end;

                    s3upload();
                }
            });
        }
    });
};
