$(function() {
    var mouseEnterCallback = function() {
        var x = $(this).parent().parent().parent().width() + 15;
        var href = $(this).find('td > a').attr('href');
        $('#preview').attr('src', href).css('left', x+'px').show();
    };
    
    var mouseLeaveCallback = function() {
        $('#preview').hide();
    };
    
    $('tbody > tr').hover(mouseEnterCallback, mouseLeaveCallback);
});
